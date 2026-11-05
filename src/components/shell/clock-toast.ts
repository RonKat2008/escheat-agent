import { splitByCoverage } from "@/lib/coverage";
import { formatUSD } from "@/lib/money";

/** What the clock API reports for a move: the items it newly detected as stale. */
export interface ClockDetected {
  count: number;
  cents: number;
  /** Of `count`, the items in states without loaded rules (real counts from the move). Absent on older responses. */
  outOfScope?: { count: number; states: string[] };
}

/**
 * Splits a move's per-state detection counts by rules coverage (src/lib/coverage.ts). Counts are the move's own
 * `byState`; nothing is estimated. Null when every detected item is in a covered state.
 */
export function outOfScopeOf(byState: Record<string, number>, ruleStates: readonly string[]): ClockDetected["outOfScope"] | null {
  const rows = Object.entries(byState).map(([state, count]) => ({ state, count, cents: 0 }));
  const { summary } = splitByCoverage(rows, ruleStates);
  if (summary.count <= 0) return null;
  return { count: summary.count, states: [...summary.states].sort() };
}

export interface DetectedToast {
  message: string;
  /** Where the toast's link goes. */
  href: string;
  linkLabel: string;
}

/**
 * The line shown after the demo clock moves. Null when nothing new was detected (the move toast already says the
 * date; a second "nothing happened" toast is noise). Counts and money are the API's own values, never recomputed.
 */
export function detectedToast(d: ClockDetected | null | undefined): DetectedToast | null {
  if (!d || !Number.isFinite(d.count) || d.count <= 0) return null;
  const items = d.count === 1 ? "1 new stale item" : `${d.count.toLocaleString("en-US")} new stale items`;
  const o = d.outOfScope;
  const out =
    o && Number.isFinite(o.count) && o.count > 0
      ? `, ${o.count.toLocaleString("en-US")} in states we don't cover yet${o.states.length ? ` (${o.states.join(", ")})` : ""}`
      : "";
  return { message: `${items} detected · ${formatUSD(d.cents)}${out}`, href: "/items", linkLabel: "Open items" };
}
