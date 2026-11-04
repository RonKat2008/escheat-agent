/**
 * Scrubber projection for the Pre-stale Horizon (pure, client-safe). The "Project forward" slider asks "what does this
 * worklist look like N days from the demo clock?". Nothing is saved and the clock never moves: every figure here is
 * derived from the items' days-until-stale minus the offset.
 *  - remaining days per item: max(0, daysUntilStale - offset); 0 means "already stale by then";
 *  - buckets: the items still pre-stale at the projected date, bucketed by days remaining from THAT date, plus the items
 *    that are already stale by then, so the tiles always sum to the worklist total;
 *  - scope: an owner state with no rule file loaded cannot be filed by this app. Those payments are grouped, not
 *    hidden, and never given dates (rules are never filled in from memory).
 */
import { bucketByDaysUntilStale, type StaleBucket } from "./buckets";
import type { HorizonItem } from "./project";

export const clampOffset = (offset: number, max = 365): number => Math.min(max, Math.max(0, Math.trunc(Number.isFinite(offset) ? offset : 0)));

/** Days left before the item is business-stale at the projected date; 0 = already stale by then. */
export const remainingAt = (item: Pick<HorizonItem, "daysUntilStale">, offset: number): number => Math.max(0, item.daysUntilStale - clampOffset(offset));

export interface ScrubbedBuckets {
  /** The four pre-stale buckets, measured from the projected date. */
  buckets: StaleBucket[];
  /** Items that have already crossed the stale line by the projected date. */
  staleByThen: { count: number; cents: number };
  totalCents: number;
}

export function bucketsAt(items: readonly HorizonItem[], offset: number): ScrubbedBuckets {
  const pre = items.filter((i) => remainingAt(i, offset) > 0).map((i) => ({ daysUntilStale: remainingAt(i, offset), amountCents: i.amountCents }));
  const crossed = items.filter((i) => remainingAt(i, offset) === 0);
  return {
    buckets: bucketByDaysUntilStale(pre),
    staleByThen: { count: crossed.length, cents: crossed.reduce((s, i) => s + i.amountCents, 0) },
    totalCents: items.reduce((s, i) => s + i.amountCents, 0),
  };
}

/** The owner state is one this app has rules loaded for (so it can be projected and filed). */
export const isInScope = (item: Pick<HorizonItem, "ownerState">, ruleStates: readonly string[]): boolean =>
  item.ownerState !== null && ruleStates.includes(item.ownerState);

export interface OutOfScopeGroup {
  /** Owner state from the address, or null when the address has no state. */
  state: string | null;
  count: number;
  cents: number;
}

export interface ScopedWorklist {
  inScope: HorizonItem[];
  outOfScope: HorizonItem[];
  groups: OutOfScopeGroup[];
  outOfScopeCents: number;
}

export function splitByScope(items: readonly HorizonItem[], ruleStates: readonly string[]): ScopedWorklist {
  const inScope = items.filter((i) => isInScope(i, ruleStates));
  const outOfScope = items.filter((i) => !isInScope(i, ruleStates));
  const byState = new Map<string | null, OutOfScopeGroup>();
  for (const i of outOfScope) {
    const g = byState.get(i.ownerState) ?? { state: i.ownerState, count: 0, cents: 0 };
    byState.set(i.ownerState, { ...g, count: g.count + 1, cents: g.cents + i.amountCents });
  }
  const groups = [...byState.values()].sort((a, b) => b.cents - a.cents || (a.state ?? "~").localeCompare(b.state ?? "~"));
  return { inScope, outOfScope, groups, outOfScopeCents: outOfScope.reduce((s, i) => s + i.amountCents, 0) };
}
