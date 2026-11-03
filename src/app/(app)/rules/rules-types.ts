/** Serializable rule-row shapes passed from the server body to the client table and drawer. */

export interface RuleSourceView {
  url: string;
  title: string;
  quote: string;
}

export interface RuleHistoryView {
  version: string;
  current: boolean;
  /** Human text, or null when the value was unknown in that version. */
  value: string | null;
  verified: boolean;
  verifiedBy: string | null;
  verifiedAt: string | null;
}

/** Plain-language status (src/lib/rules/unknown-copy.ts describeRuleStatus); never the developer research note. */
export interface RuleStatusView {
  kind: "verified" | "unverified" | "official_text_found" | "missing";
  text: string;
  source: { title: string; url: string; host: string } | null;
}

export interface RuleRow {
  path: string;
  label: string;
  group: string;
  /** Human text, or null when the value is unknown. */
  value: string | null;
  /** Value is an identifier (e.g. a NAUPA code) and is shown in mono. */
  code: boolean;
  verified: boolean;
  verifiedBy: string | null;
  verifiedAt: string | null;
  /** R4-01: the approved owner-facing sentence letters print (notice language only). */
  ownerText: string | null;
  todo: string | null;
  sources: RuleSourceView[];
  /** Unverified with a value: a human can approve it. */
  approvable: boolean;
  /** Reference-only value (format, portal): shown, never approved here. */
  reference: boolean;
  history: RuleHistoryView[];
  /** null for reference-only rows (format, portal). */
  status: RuleStatusView | null;
}

export interface RuleGroup {
  name: string;
  rows: RuleRow[];
}
