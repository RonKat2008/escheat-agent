/**
 * Figures the marketing pages quote, read straight from the rule files (rules/*.json) at build time so the copy can
 * never drift from the engine's inputs. Every value keeps its `verified` flag and its sources; the pages badge each
 * unverified value. Import from server components only (keeps the JSON out of client bundles).
 */
import CA from "../../../rules/CA.json";
import DE from "../../../rules/DE.json";
import TX from "../../../rules/TX.json";

interface Source {
  url: string;
  title: string;
  quote: string;
}

export interface Fact<T> {
  value: T | null;
  verified: boolean;
  source: Source | null;
  path: string;
}

interface RawValue {
  value: unknown;
  verified?: boolean;
  sources?: { url?: string; title?: string; quote?: string }[];
}

function fact<T>(raw: RawValue | undefined, path: string, pick: (v: unknown) => T | null): Fact<T> {
  const s = raw?.sources?.[0];
  return {
    value: raw && raw.value != null ? pick(raw.value) : null,
    verified: raw?.verified === true,
    source: s?.url ? { url: s.url, title: s.title ?? s.url, quote: s.quote ?? "" } : null,
    path,
  };
}

const num = (v: unknown) => (typeof v === "number" ? v : null);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface StateRuleFacts {
  code: "CA" | "DE" | "TX";
  name: string;
  version: string;
  dormancyYears: Fact<number>;
  noticeWindow: Fact<{ min: number | null; max: number | null }>;
  reportDue: Fact<{ label: string; withRemittance: boolean }>;
  interestPct: Fact<number>;
}

interface RawRules {
  version: string;
  propertyTypes: { vendor_check: { dormancyYears: RawValue } };
  dueDiligence: { windowDaysBeforeReport: RawValue };
  reportStages: { name: string; dueRule: RawValue; includesRemittance: RawValue }[];
  interest: RawValue;
}

function dueLabel(v: unknown): string | null {
  if (!v || typeof v !== "object") return null;
  const d = v as { type?: string; month?: number; day?: number; yearOffset?: number };
  if (d.type !== "fixed_date" || !d.month || !d.day) return null;
  return `${MONTHS[d.month - 1]} ${d.day}${d.yearOffset ? ", following year" : ""}`;
}

function build(code: StateRuleFacts["code"], name: string, raw: RawRules): StateRuleFacts {
  const last = raw.reportStages.length - 1;
  const stage = raw.reportStages[last]!;
  return {
    code,
    name,
    version: raw.version,
    dormancyYears: fact(raw.propertyTypes.vendor_check.dormancyYears, "propertyTypes.vendor_check.dormancyYears", num),
    noticeWindow: fact(raw.dueDiligence.windowDaysBeforeReport, "dueDiligence.windowDaysBeforeReport", (v) => {
      const w = v as { min?: unknown; max?: unknown };
      return { min: num(w.min), max: num(w.max) };
    }),
    reportDue: fact(stage.dueRule, `reportStages[${last}].dueRule`, (v) => {
      const label = dueLabel(v);
      return label ? { label, withRemittance: stage.includesRemittance.value === true } : null;
    }),
    interestPct: fact(raw.interest, "interest", (v) => num((v as { annualRatePct?: unknown }).annualRatePct)),
  };
}

export const STATE_RULES: readonly StateRuleFacts[] = [
  build("CA", "California", CA as unknown as RawRules),
  build("DE", "Delaware", DE as unknown as RawRules),
  build("TX", "Texas", TX as unknown as RawRules),
];

export function noticeWindowLabel(w: Fact<{ min: number | null; max: number | null }>): string | null {
  if (!w.value || w.value.min == null) return null;
  return w.value.max == null ? `${w.value.min}+ days before the report` : `${w.value.min} to ${w.value.max} days before the report`;
}
