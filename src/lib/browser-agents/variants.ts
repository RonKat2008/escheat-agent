import { normalizeName, normalizeTokens } from "@/lib/payees/normalize";
import { jaroWinkler, tokenJaccard } from "@/lib/payees/similarity";

/** Matches below this confidence (0..100) are never surfaced as recoveries. */
export const MATCH_THRESHOLD = 85;

const TRAILING_SUFFIX = /[\s,]+(incorporated|inc|llc|l\.l\.c|corp|corporation|co|company|ltd)\.?\s*$/i;

function squash(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Strips punctuation to bare uppercase words: "Northwind Fixtures, Inc." -> "NORTHWIND FIXTURES INC". */
export function stripPunctuation(name: string): string {
  return squash(name.toUpperCase().replace(/&/g, " AND ").replace(/[^A-Z0-9]+/g, " "));
}

export function stripLegalSuffix(name: string): string {
  return squash(name.replace(TRAILING_SUFFIX, ""));
}

/**
 * Search variants for the holder's own name: the raw name, an uppercase and punctuation-free form,
 * and suffix-less forms. De-duplicated case-insensitively, order stable, raw name first.
 */
export function companyNameVariants(companyName: string): string[] {
  const raw = squash(companyName);
  if (raw === "") return [];
  const candidates = [raw, raw.toUpperCase(), stripPunctuation(raw), stripLegalSuffix(raw), stripLegalSuffix(stripPunctuation(raw))];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of candidates) {
    const key = c.toLowerCase();
    if (c === "" || seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

export interface PayeeAliasSource {
  canonicalName: string;
  aliases: readonly string[];
}

/** A payee "is" the company when its normalized name is identical or near-identical to the company's. */
export function payeeMatchesCompany(companyName: string, candidate: string): boolean {
  const a = normalizeName(companyName);
  const b = normalizeName(candidate);
  if (a === "" || b === "") return false;
  if (a === b) return true;
  return jaroWinkler(a, b) >= 0.94 && tokenJaccard(a.split(" "), b.split(" ")) >= 0.66;
}

/** Company-name variants plus any payee names/aliases that normalize to the company. */
export function buildNameVariants(companyName: string, payees: readonly PayeeAliasSource[]): string[] {
  const out = [...companyNameVariants(companyName)];
  const seen = new Set(out.map((v) => v.toLowerCase()));
  for (const p of payees) {
    for (const name of [p.canonicalName, ...p.aliases]) {
      if (!payeeMatchesCompany(companyName, name)) continue;
      for (const v of companyNameVariants(name)) {
        if (!seen.has(v.toLowerCase())) {
          seen.add(v.toLowerCase());
          out.push(v);
        }
      }
    }
  }
  return out;
}

export interface MatchScore {
  /** 0..100 */
  confidence: number;
  jaroWinkler: number;
  tokenJaccard: number;
}

/**
 * Blend of character similarity (Jaro-Winkler) and token overlap (Jaccard) on normalized names.
 * Jaccard is weighted so near-miss decoys that share most letters ("NORTHWEST FIXTURES") fall below the threshold.
 */
export function scoreNameMatch(variant: string, recordOwner: string): MatchScore {
  const va = normalizeTokens(variant);
  const vb = normalizeTokens(recordOwner);
  const jw = jaroWinkler(va.join(" "), vb.join(" "));
  const tj = tokenJaccard(va, vb);
  return { confidence: Math.round((0.6 * jw + 0.4 * tj) * 100), jaroWinkler: jw, tokenJaccard: tj };
}

export function bestVariantScore(variants: readonly string[], recordOwner: string): (MatchScore & { variant: string }) | null {
  let best: (MatchScore & { variant: string }) | null = null;
  for (const v of variants) {
    const s = scoreNameMatch(v, recordOwner);
    if (!best || s.confidence > best.confidence) best = { ...s, variant: v };
  }
  return best;
}
