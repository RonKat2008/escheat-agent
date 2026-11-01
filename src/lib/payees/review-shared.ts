/** Constants and pure helpers shared by the server queries and the client UI (no db imports here). */
import { normalizeName } from "./normalize";

/** Merge confidence below this (0..100) is surfaced for review. */
export const LOW_CONFIDENCE = 90;

/** Rows per page on /payees. */
export const PAGE_SIZE = 25;

const isMixedCase = (s: string) => s !== s.toUpperCase() && s !== s.toLowerCase();
/** "Clean" = no legal suffix or abbreviation that normalization would rewrite. */
const isClean = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() === normalizeName(s);

/**
 * Sort order for choosing which payee name survives a merge: properly cased beats SHOUTED, a clean name beats one with
 * a suffix or abbreviation, then the longer name wins. Negative when `a` is the better canonical name.
 */
export function compareCanonicalNames(a: string, b: string): number {
  const x = a.trim();
  const y = b.trim();
  return (
    Number(isMixedCase(y)) - Number(isMixedCase(x)) ||
    Number(isClean(y)) - Number(isClean(x)) ||
    y.length - x.length ||
    x.localeCompare(y)
  );
}
