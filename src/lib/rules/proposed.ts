import type { RuleSource, RuleValue } from "../../../rules/schema";

/**
 * R3-05: a deterministic "proposed value" for a rule field that is still UNKNOWN (value null) but whose cited sources
 * already quote the official text. Pure string matching, no model call, no paraphrase: a candidate exists only when
 * an OFFICIAL source's quote itself declares the text ("The notice must include the following language: ..."), and
 * the candidate is the exact characters that follow that declaration in the quote. The research note (`todo`) is the
 * researcher's own words, so it is never used as a source of text.
 *
 * A proposal is only a suggestion. It becomes the rule value only through adoptProposedValue (./adopt.ts), which
 * needs a human approval bound to the file version, sha256 and the exact proposed text.
 */

export type ProposalConfidence = "verbatim_quote" | "none";

export type ProposalRefusal =
  /** The field already has a value; nothing to propose. */
  | "has_value"
  /** No cited source has a quote. */
  | "no_quote"
  /** Quotes exist, but none comes from an official (government) URL. */
  | "no_official_source"
  /** Official quotes exist, but none declares a verbatim text to use. */
  | "no_declared_text";

export interface ProposedValue {
  /** Exact candidate text (a substring of `quote`), or null when there is none. */
  proposed: string | null;
  /** The full quote the candidate was taken from. */
  quote: string | null;
  /** The cited source(s) whose quote contains the candidate verbatim (first one is where it was found). */
  sources: RuleSource[];
  confidence: ProposalConfidence;
  /** Why there is no candidate (only when confidence is "none"). */
  reason?: ProposalRefusal;
}

/**
 * Phrases by which an official source says the text that follows is the required wording. The candidate is the
 * remainder of the quote after the colon, so the source itself decides where the text starts.
 */
const DECLARATION = /\b(?:must|shall)\s+(?:include|contain|state|read)\s+(?:the\s+)?following\s+(?:language|statement|text|wording|words)\s*:\s*/i;

/** Hostnames of government publishers: *.gov, and state sites under *.<st>.us (e.g. *.state.tx.us). */
export function isOfficialSourceUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  const host = u.hostname.toLowerCase();
  return host.endsWith(".gov") || /\.[a-z]{2}\.us$/.test(host);
}

const none = (reason: ProposalRefusal): ProposedValue => ({ proposed: null, quote: null, sources: [], confidence: "none", reason });

/** The declared verbatim text inside one quote, or null. */
export function declaredText(quote: string): string | null {
  const m = DECLARATION.exec(quote);
  if (!m) return null;
  const text = quote.slice(m.index + m[0].length).trim();
  return text.length > 0 && quote.includes(text) ? text : null;
}

export function proposedValue(envelope: Pick<RuleValue<unknown>, "value" | "sources">): ProposedValue {
  if (envelope.value !== null) return none("has_value");
  const quoted = envelope.sources.filter((s) => s.quote.trim().length > 0);
  if (quoted.length === 0) return none("no_quote");
  const official = quoted.filter((s) => isOfficialSourceUrl(s.url));
  if (official.length === 0) return none("no_official_source");
  for (const src of official) {
    const text = declaredText(src.quote);
    if (text === null) continue;
    const corroborating = official.filter((s) => s !== src && s.quote.includes(text));
    return { proposed: text, quote: src.quote, sources: [src, ...corroborating], confidence: "verbatim_quote" };
  }
  return none("no_declared_text");
}
