/**
 * Client-safe horizon phase math (no rules engine, no fs): shared by the server projection and the scrubber in the browser.
 */

/** Same rule as detection (src/lib/recon/reconcile.ts isStale): stale once the age is strictly over the threshold. */
export const isStaleAtAge = (ageDays: number, thresholdDays: number): boolean => ageDays > thresholdDays;

/** Days until stale from a given age; 0 means already stale. */
export const daysUntilStaleAt = (ageDays: number, thresholdDays: number): number => Math.max(0, thresholdDays + 1 - ageDays);

export type HorizonPhase = "outstanding" | "stale" | "presumed_abandoned";

/** Where an item stands at a projected age (the scrubber adds days; the demo clock never moves). */
export function phaseAtAge(ageDays: number, thresholdDays: number, presumedAtAgeDays: number | null): HorizonPhase {
  if (presumedAtAgeDays !== null && ageDays >= presumedAtAgeDays) return "presumed_abandoned";
  return isStaleAtAge(ageDays, thresholdDays) ? "stale" : "outstanding";
}
