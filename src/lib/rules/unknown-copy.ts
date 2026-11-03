import type { RuleSource, RuleValue } from "../../../rules/schema";
import { fieldMeta } from "./labels";
import { proposedValue } from "./proposed";

/**
 * R3-05: plain-language status for a rule value, for users. The research note (`todo`) is written for developers and
 * reviewers (it can name test files or encoding choices), so it is NEVER copied into this text; only the state, the
 * field's human label and the cited source's title/host are used.
 */

export type RuleStatusKind = "verified" | "unverified" | "official_text_found" | "missing";

export interface RuleStatusCopy {
  kind: RuleStatusKind;
  /** One sentence, e.g. "Texas notice wording not yet confirmed; official text found at ..., awaiting human approval." */
  text: string;
  /** Where the official text was found (only for official_text_found). */
  source?: { title: string; url: string; host: string };
}

const STATE_NAMES: Record<string, string> = { CA: "California", DE: "Delaware", TX: "Texas" };

/** Field nouns that read better in a sentence than the table label. */
const FIELD_NOUNS: Record<string, string> = {
  "dueDiligence.requiredLanguage": "notice wording",
};

export const stateName = (state: string): string => STATE_NAMES[state.toUpperCase()] ?? state.toUpperCase();

function fieldNoun(path: string): string {
  const noun = FIELD_NOUNS[path];
  if (noun) return noun;
  const { group, label } = fieldMeta(path);
  const l = label.charAt(0).toLowerCase() + label.slice(1);
  return path.startsWith("propertyTypes.") ? `${group.toLowerCase()} ${l}` : l;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function sourceLabel(s: RuleSource): { title: string; url: string; host: string } {
  const host = hostOf(s.url);
  return { title: s.title.trim() || host, url: s.url, host };
}

export function describeRuleStatus(state: string, path: string, envelope: Pick<RuleValue<unknown>, "value" | "sources" | "verified" | "verified_by">): RuleStatusCopy {
  const subject = `${stateName(state)} ${fieldNoun(path)}`;
  if (envelope.value !== null) {
    if (envelope.verified) {
      const by = envelope.verified_by?.trim();
      return { kind: "verified", text: `${subject} confirmed${by ? ` by ${by}` : ""}.` };
    }
    return { kind: "unverified", text: `${subject} has a researched value that a person has not confirmed yet.` };
  }
  const p = proposedValue(envelope);
  if (p.confidence === "verbatim_quote" && p.sources[0]) {
    const source = sourceLabel(p.sources[0]);
    return {
      kind: "official_text_found",
      text: `${subject} not yet confirmed; official text found at ${source.title} (${source.host}), awaiting human approval.`,
      source,
    };
  }
  return { kind: "missing", text: `${subject} not yet confirmed, and no official text is on file yet. It needs research and a person's approval.` };
}
