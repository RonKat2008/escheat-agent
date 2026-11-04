/**
 * Audit Drill sampling. An auditor's sample must be reproducible: the same state, demo date and sample size always
 * draw the same items. The seed is sha256("<STATE>|<YYYY-MM-DD>|<size>"), which drives the deterministic PRNG used
 * for synthetic data; the population is sorted by id first so database row order never changes the draw.
 */
import { createHash } from "node:crypto";
import { createRng } from "@/lib/synthetic/prng";

export const AUDIT_STATES = ["CA", "DE", "TX"] as const;
export type AuditState = (typeof AUDIT_STATES)[number];

export const SAMPLE_SIZES = [5, 10, 25] as const;
export type SampleSize = (typeof SAMPLE_SIZES)[number];
export const DEFAULT_SAMPLE_SIZE: SampleSize = 5;

/** Hex sha256 of the sample inputs. */
export function auditSeed(state: string, demoDate: string, size: number): string {
  return createHash("sha256").update(`${state.toUpperCase()}|${demoDate}|${size}`).digest("hex");
}

/**
 * Up to `size` ids drawn without replacement, in draw order. Capped at the population. `all` returns every id
 * (sorted) instead of a sample.
 */
export function drawSample(ids: readonly string[], seedHex: string, size: number, all = false): string[] {
  const sorted = [...new Set(ids)].sort();
  if (all) return sorted;
  const n = Math.max(0, Math.min(Math.floor(size), sorted.length));
  const rng = createRng(Number.parseInt(seedHex.slice(0, 8), 16) >>> 0, "audit-drill");
  return rng.shuffle(sorted).slice(0, n);
}
