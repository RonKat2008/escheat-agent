/** Test helpers for the ledger unit tests (not imported by app code). */
import type { PropertyType } from "./accounts";
import type { LedgerItem } from "./movements";

let n = 0;
export function item(over: Partial<LedgerItem> = {}): LedgerItem {
  n += 1;
  return {
    id: `item-${n}`,
    state: "TX",
    propertyType: "vendor_check" as PropertyType,
    amountCents: 10_000,
    status: "watching",
    staleSince: "2026-03-10",
    resolvedAt: null,
    classification: null,
    lateClearDate: null,
    payee: `Payee ${n}`,
    checkNumber: String(1000 + n),
    dependsOnUnverified: false,
    ...over,
  };
}

/** Deterministic pseudo-random generator (mulberry32) so the property tests are reproducible. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
