/**
 * Rules coverage: which owner states this app has a rules file for ("in scope": it can project dates and file) and
 * which it does not ("not covered yet"). One definition for every surface so they never disagree. It mirrors the
 * Horizon worklist (`isInScope` in src/lib/horizon/scrub.ts): a state is covered only when a rules file is loaded;
 * an unknown owner state is never covered. Pure and client-safe; the server-side list of covered states is `inScopeStates()` in coverage-server.ts.
 */
import { formatUSD } from "@/lib/money";

/** Sentinel the exposure/map queries use for an item with no owner state. */
export const UNKNOWN_STATE = "UNKNOWN";

export interface CoverageRow {
  state: string | null;
  cents: number;
  count: number;
}

export interface NotCoveredSummary {
  /** Owner-state codes (sorted by amount, then code). Items with no state are counted but not listed here. */
  states: string[];
  count: number;
  cents: number;
  formatted: string;
  /** True when some of the items have no owner state at all. */
  hasUnknownState: boolean;
}

export interface CoverageSplit<T extends CoverageRow> {
  inScope: T[];
  notCovered: T[];
  inScopeCount: number;
  inScopeCents: number;
  summary: NotCoveredSummary;
}

export const isStateCovered = (state: string | null | undefined, ruleStates: readonly string[]): boolean =>
  Boolean(state) && state !== UNKNOWN_STATE && ruleStates.includes(state as string);

/** Splits per-state rows into covered and not covered, with the not-covered rollup every surface shows. */
export function splitByCoverage<T extends CoverageRow>(rows: readonly T[], ruleStates: readonly string[]): CoverageSplit<T> {
  const inScope = rows.filter((r) => isStateCovered(r.state, ruleStates));
  const notCovered = rows.filter((r) => !isStateCovered(r.state, ruleStates));
  const sorted = [...notCovered].sort((a, b) => b.cents - a.cents || (a.state ?? "~").localeCompare(b.state ?? "~"));
  const cents = notCovered.reduce((s, r) => s + r.cents, 0);
  return {
    inScope,
    notCovered,
    inScopeCount: inScope.reduce((s, r) => s + r.count, 0),
    inScopeCents: inScope.reduce((s, r) => s + r.cents, 0),
    summary: {
      states: sorted.map((r) => r.state).filter((s): s is string => Boolean(s) && s !== UNKNOWN_STATE),
      count: notCovered.reduce((s, r) => s + r.count, 0),
      cents,
      formatted: formatUSD(cents),
      hasUnknownState: notCovered.some((r) => !r.state || r.state === UNKNOWN_STATE),
    },
  };
}

/** "FL, IL, NY, OR" (plus "no state" when some items have none). */
export function notCoveredStatesLabel(s: NotCoveredSummary): string {
  return [...s.states, ...(s.hasUnknownState ? ["no state"] : [])].join(", ");
}

/** One honest sentence, shared word for word by the dashboard, Items, Forecast, Ledger, chat and the CFO brief. */
export const NOT_COVERED_COPY =
  "Rules are not loaded for these states, so this app shows no legal dates for them and cannot file them. Nothing here is guessed; the money is still owed.";

/** "Not covered yet: FL, IL, NY, OR · 4 items · $3,497.40". */
export function notCoveredLine(s: NotCoveredSummary): string {
  return `Not covered yet: ${notCoveredStatesLabel(s)} · ${s.count} ${s.count === 1 ? "item" : "items"} · ${s.formatted}`;
}
