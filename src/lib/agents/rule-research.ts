import { z } from "zod";
import type { Db } from "@/db/client";
import { callStructured, type Citation } from "@/lib/llm/client";
import { PROPERTY_TYPES, type PropertyTypeValue } from "./types";

/*
 * TODO(L3): rules/schema.ts owns the canonical RuleFile Zod schema. This file defines a compatible local
 * draft shape ({ value, sources[{url,title,quote,retrieved_at}], verified, todo? } per field). Swap to the
 * canonical schema once it exists; the enforcement below (code, not prompt) stays the same.
 */

export const RESEARCH_FIELDS = [
  "dormancy_months",
  "dd_window_days_min",
  "dd_window_days_max",
  "min_reportable_cents",
  "naupa_code",
  "report_due_description",
] as const;
export type ResearchField = (typeof RESEARCH_FIELDS)[number];

const NUMERIC_FIELDS: ReadonlySet<string> = new Set([
  "dormancy_months",
  "dd_window_days_min",
  "dd_window_days_max",
  "min_reportable_cents",
]);

export const OFFICIAL_DOMAINS: Record<string, string[]> = {
  CA: ["sco.ca.gov", "leginfo.legislature.ca.gov"],
  DE: ["unclaimedproperty.delaware.gov", "delcode.delaware.gov"],
  TX: ["comptroller.texas.gov", "statutes.capitol.texas.gov"],
};
export const SHARED_DOMAINS = ["unclaimed.org"];

export const ruleSourceSchema = z.object({
  url: z.string().url(),
  title: z.string().nullable(),
  quote: z.string().min(1),
  retrieved_at: z.string(),
});
export type RuleSource = z.infer<typeof ruleSourceSchema>;

export const ruleValueSchema = z.object({
  value: z.union([z.string(), z.number()]).nullable(),
  sources: z.array(ruleSourceSchema),
  verified: z.literal(false),
  todo: z.string().optional(),
});
export type RuleValue = z.infer<typeof ruleValueSchema>;

export interface RuleFileDraft {
  state: string;
  generated_at: string;
  verified: false;
  properties: Partial<Record<PropertyTypeValue, Record<ResearchField, RuleValue>>>;
  source_urls: string[];
}

/** What the model submits (untrusted until enforceCitations runs). */
export const modelResearchSchema = z.object({
  fields: z.array(
    z.object({
      property_type: z.enum(PROPERTY_TYPES),
      field: z.enum(RESEARCH_FIELDS),
      value: z.union([z.string(), z.number()]).nullable(),
      sources: z.array(z.object({ url: z.string(), title: z.string().nullish(), quote: z.string() })),
    }),
  ),
});
export type ModelResearch = z.infer<typeof modelResearchSchema>;

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

function hostAllowed(url: string, domains: readonly string[]): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return domains.some((d) => host === d || host.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

function missing(reason: string): RuleValue {
  return { value: null, sources: [], verified: false, todo: reason };
}

/**
 * Code-enforced citation policy (the prompt is only a request):
 * - a source survives only if its URL is an official allowed domain AND was actually returned by search/citations,
 *   and its quote is text from a citation for that URL (the model's quote if it appears in cited text, else the cited text);
 * - a value with no surviving source becomes null + todo; verified is always false.
 */
export function enforceCitations(
  raw: ModelResearch,
  propertyTypes: readonly PropertyTypeValue[],
  citations: readonly Citation[],
  opts: { allowedDomains: readonly string[]; now?: Date },
): Record<string, Record<ResearchField, RuleValue>> {
  const retrievedAt = (opts.now ?? new Date()).toISOString();
  const byUrl = new Map<string, Citation[]>();
  for (const c of citations) byUrl.set(c.url, [...(byUrl.get(c.url) ?? []), c]);

  const out: Record<string, Record<ResearchField, RuleValue>> = {};
  for (const pt of propertyTypes) {
    const fields = {} as Record<ResearchField, RuleValue>;
    for (const field of RESEARCH_FIELDS) {
      const entry = raw.fields.find((f) => f.property_type === pt && f.field === field);
      if (!entry || entry.value === null) {
        fields[field] = missing(
          entry ? "Model found no value; research manually from the state's official source." : "Not researched.",
        );
        continue;
      }
      if (NUMERIC_FIELDS.has(field) && !(typeof entry.value === "number" && Number.isFinite(entry.value) && entry.value >= 0)) {
        fields[field] = missing(`Model returned a non-numeric value for ${field}; discarded.`);
        continue;
      }
      const sources: RuleSource[] = [];
      for (const s of entry.sources) {
        if (!hostAllowed(s.url, opts.allowedDomains)) continue;
        const cites = (byUrl.get(s.url) ?? []).filter((c) => c.citedText);
        if (cites.length === 0) continue;
        const wanted = norm(s.quote);
        const exact = cites.find((c) => wanted.length > 0 && norm(c.citedText ?? "").includes(wanted));
        const chosen = exact ?? cites[0];
        if (!chosen?.citedText) continue;
        sources.push({
          url: s.url,
          title: s.title ?? chosen.title,
          quote: exact ? s.quote.trim() : chosen.citedText.trim(),
          retrieved_at: retrievedAt,
        });
      }
      fields[field] =
        sources.length === 0
          ? missing("Value had no citation from an official source; discarded (needs manual research).")
          : { value: entry.value, sources, verified: false };
    }
    out[pt] = fields;
  }
  return out;
}

const SYSTEM = `You are a research assistant extracting unclaimed-property (escheat) rules for one US state from OFFICIAL sources only
(state statutes, controller/treasurer pages, unclaimed.org). Use the web search tool. For each requested property type, find:
dormancy_months (period before presumed abandoned), dd_window_days_min / dd_window_days_max (owner due-diligence notice window, in days before the report is due),
min_reportable_cents (de minimis threshold in cents), naupa_code (NAUPA property type code), report_due_description (when the holder report is due).
First write your findings in plain text so each claim carries a search citation, quoting the statute or page wording. Then call the submit tool.
Rules: NEVER answer from memory. If you cannot find a value in an official source, submit value null. For each value give sources
with the exact official URL and a short verbatim quote. You do not decide the law; a human verifies everything you return.`;

export interface ResearchOptions {
  db?: Db;
  companyId?: string;
  allowedDomains?: string[];
  maxSearches?: number;
  now?: Date;
}

export async function researchStateRules(
  state: string,
  propertyTypes: readonly PropertyTypeValue[],
  opts: ResearchOptions = {},
): Promise<RuleFileDraft> {
  const code = state.toUpperCase();
  const allowedDomains = opts.allowedDomains ?? [...(OFFICIAL_DOMAINS[code] ?? []), ...SHARED_DOMAINS];
  const res = await callStructured({
    tier: "orchestrator",
    agent: "rule-research",
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: JSON.stringify({ state: code, property_types: propertyTypes, fields: RESEARCH_FIELDS }),
      },
    ],
    schema: modelResearchSchema,
    toolName: "submit_rule_research",
    toolDescription: "Submit researched rule values with sources.",
    webSearch: { maxUses: opts.maxSearches ?? 10, allowedDomains },
    subjectId: code,
    db: opts.db,
    companyId: opts.companyId,
    maxTokens: 16_000,
  });
  const enforced = enforceCitations(res.data, propertyTypes, res.citations, { allowedDomains, now: opts.now });
  const urls = new Set<string>();
  for (const fields of Object.values(enforced)) {
    for (const v of Object.values(fields)) v.sources.forEach((s) => urls.add(s.url));
  }
  return {
    state: code,
    generated_at: (opts.now ?? new Date()).toISOString(),
    verified: false,
    properties: enforced,
    source_urls: [...urls],
  };
}
