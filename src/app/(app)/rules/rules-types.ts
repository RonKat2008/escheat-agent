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
  todo: string | null;
  sources: RuleSourceView[];
  /** Unverified with a value: a human can approve it. */
  approvable: boolean;
  /** Reference-only value (format, portal): shown, never approved here. */
  reference: boolean;
  history: RuleHistoryView[];
}

export interface RuleGroup {
  name: string;
  rows: RuleRow[];
}
