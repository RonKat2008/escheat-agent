/**
 * "Why this date?" view model (DESIGN-V3 §4.4, item variant). Layers, left to right in the full graph and top to
 * bottom in the drawer: derivation steps -> the date -> rule values used -> sources -> verification.
 * Pure: every string comes from the rules engine's explanation (explainItem().timeline); nothing is recomputed.
 */

export interface WhySource {
  url: string;
  title: string;
  quote: string;
}

export interface WhyInput {
  key: string;
  label: string;
  date: string | null;
  status: "ok" | "unknown" | "not_applicable";
  verified: boolean;
  /** Legal dates come from rule files; ledger facts (issued, stale) do not. */
  legal: boolean;
  ruleVersion: string | null;
  rulePaths: string[];
  sources: WhySource[];
  derivation: string[];
  roll: string | null;
  notes: string[];
}

export type WhyVerification = "unverified" | "verified" | "not_a_rule";

export interface WhyModel {
  key: string;
  label: string;
  date: string | null;
  /** Why the date is missing, from the engine's notes; null when dated. */
  unknownReason: string | null;
  steps: string[];
  roll: string | null;
  rules: { path: string; version: string | null }[];
  /** De-duplicated by URL; only http(s) links survive. */
  sources: WhySource[];
  verification: WhyVerification;
  /** Number of layers actually drawn (for the connector rail and tests). */
  layerCount: number;
}

function isHttp(url: string): boolean {
  try {
    const p = new URL(url).protocol;
    return p === "http:" || p === "https:";
  } catch {
    return false;
  }
}

export function buildWhy(n: WhyInput): WhyModel {
  const seen = new Set<string>();
  const sources = n.sources.filter((s) => {
    const url = s.url.trim();
    if (!url || !isHttp(url) || seen.has(url)) return false;
    seen.add(url);
    return true;
  });
  const rules = n.legal ? n.rulePaths.map((path) => ({ path, version: n.ruleVersion })) : [];
  const verification: WhyVerification = !n.legal ? "not_a_rule" : n.verified ? "verified" : "unverified";
  const dated = n.date !== null && n.status === "ok";
  const unknownReason = dated ? null : n.notes.join(" ") || (n.status === "not_applicable" ? "Does not apply to this item." : "The rules engine could not compute this date.");
  const steps = n.derivation;
  const layerCount = (steps.length > 0 ? 1 : 0) + 1 + (rules.length > 0 ? 1 : 0) + (sources.length > 0 ? 1 : 0) + 1;
  return { key: n.key, label: n.label, date: dated ? n.date : null, unknownReason, steps, roll: n.roll, rules, sources, verification, layerCount };
}

/** Which date to explain first: the next deadline when it has a derivation, else the first legal date that does. */
export function defaultWhyKey(nodes: readonly Pick<WhyInput, "key" | "legal" | "derivation" | "date">[], nextKey: string | undefined): string | null {
  if (nextKey && nodes.some((n) => n.key === nextKey)) return nextKey;
  const legal = nodes.filter((n) => n.legal);
  return (legal.find((n) => n.derivation.length > 0) ?? legal.find((n) => n.date) ?? legal[0] ?? nodes[0])?.key ?? null;
}
