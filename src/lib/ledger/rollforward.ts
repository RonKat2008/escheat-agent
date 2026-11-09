/**
 * R8 Escheat Ledger: the liability roll-forward for a period, per owner state and in total, in integer cents.
 *
 *   opening + prior-period adjustment + identified - resolved with owner - cleared late by bank - remitted = closing
 *
 * The prior-period adjustment (R11-01) is the net of movements dated inside books that were already closed (flagged
 * `priorPeriodOf` by ../ledger/closes.ts and posted on the first day of the earliest open month). It is its own line,
 * so the flow lines only hold activity that really happened in the period.
 *
 * `opening` is the balance at the end of the day before the period starts and `closing` is computed from the flows;
 * `reconciles` checks that closing equals the balance computed independently at the period end, so the identity is
 * tested, not assumed. Periods end on the demo-clock date ("to date"). Pure.
 */
import { addDays, addMonths, fromYMD, isIsoDate, type IsoDate } from "@/lib/dates";
import { SETTLEMENT_KINDS, type Movement, type MovementKind } from "./movements";

export const PERIOD_IDS = ["month", "quarter", "fy", "all"] as const;
export type PeriodId = (typeof PERIOD_IDS)[number];
export const DEFAULT_PERIOD: PeriodId = "fy";

export interface Period {
  id: PeriodId;
  /** Chip label: "This month", "Quarter", "FY 2026", "Since start". */
  label: string;
  /** Inclusive YYYY-MM-DD bounds; `end` is the demo-clock date. */
  start: string;
  end: string;
}

/** The fiscal year containing `today` for a fiscal year end "MM-DD" (companies.fiscal_year_end, default 12-31). */
export function fiscalYear(today: string, fiscalYearEnd: string): { start: string; end: string; year: number } {
  const m = /^(\d{2})-(\d{2})$/.exec(fiscalYearEnd);
  const mm = m ? Number(m[1]) : 12;
  const dd = m ? Number(m[2]) : 31;
  const endIn = (y: number): IsoDate => {
    const last = new Date(Date.UTC(y, mm, 0)).getUTCDate();
    return fromYMD(y, mm, Math.min(dd, last));
  };
  const y = Number(today.slice(0, 4));
  const end = today <= endIn(y) ? endIn(y) : endIn(y + 1);
  const year = Number(end.slice(0, 4));
  return { start: addDays(endIn(year - 1), 1), end, year };
}

/** The period chip's bounds. "Since start" begins on the earliest movement (opening 0). */
export function periodFor(id: PeriodId, today: string, fiscalYearEnd: string, earliest: string | null): Period {
  const fy = fiscalYear(today, fiscalYearEnd);
  switch (id) {
    case "month":
      return { id, label: "This month", start: `${today.slice(0, 7)}-01`, end: today };
    case "quarter": {
      let start = fy.start;
      for (let k = 1; k < 4; k++) {
        const s = addMonths(fy.start as IsoDate, 3 * k);
        if (s <= today) start = s;
      }
      return { id, label: "Quarter", start, end: today };
    }
    case "fy":
      return { id, label: `FY ${fy.year}`, start: fy.start, end: today };
    case "all": {
      const start = earliest && isIsoDate(earliest) && earliest < today ? earliest : today;
      return { id, label: "Since start", start, end: today };
    }
  }
}

export const isSettlement = (k: MovementKind): boolean => SETTLEMENT_KINDS.includes(k);
const signed = (m: Movement): number => (isSettlement(m.kind) ? -m.amountCents : m.amountCents);

/** Liability at the end of `date` (every movement on or before it). */
export function balanceAsOf(movements: readonly Movement[], date: string): number {
  let sum = 0;
  for (const m of movements) if (m.date <= date) sum += signed(m);
  return sum;
}

export interface Roll {
  state: string;
  opening: number;
  /** Net signed cents of prior-period adjustments posted in the period (late activity dated in closed books). */
  priorPeriod: number;
  identified: number;
  resolved: number;
  clearedLate: number;
  remitted: number;
  closing: number;
  /** closing === the balance computed independently at the period end. */
  reconciles: boolean;
}

export interface RollForward {
  period: Period;
  /** Owner states present, CA/DE/TX first, then others alphabetically, UNKNOWN last. */
  states: Roll[];
  total: Roll;
  /** The period's movements (what the bars and the journal are made of). */
  movements: Movement[];
  /** Whether any item ever cleared late at the bank (the line only shows when one exists). */
  anyClearedLate: boolean;
  /** The period's prior-period adjustments, summed (null when there are none). */
  adjustment: PriorPeriodAdjustment | null;
}

export interface PriorPeriodAdjustment {
  /** Movements (rows) posted as adjustments. */
  count: number;
  /** Net signed cents (recognitions add, settlements subtract). */
  cents: number;
  /** The closed months the rows were dated in ("YYYY-MM", ascending). */
  months: string[];
  /** The month they post in ("YYYY-MM"). */
  postedIn: string;
}

/** Sum of the prior-period adjustments among `movements` (already limited to a period), or null when there are none. */
export function adjustmentOf(movements: readonly Movement[]): PriorPeriodAdjustment | null {
  const adj = movements.filter((m) => m.priorPeriodOf !== undefined);
  if (adj.length === 0) return null;
  return {
    count: adj.length,
    cents: adj.reduce((a, m) => a + signed(m), 0),
    months: [...new Set(adj.map((m) => m.priorPeriodOf!))].sort(),
    postedIn: adj.reduce((d, m) => (m.date < d ? m.date : d), adj[0]!.date).slice(0, 7),
  };
}

const ORDER = ["CA", "DE", "TX"];
export function stateOrder(a: string, b: string): number {
  const rank = (s: string) => (ORDER.includes(s) ? ORDER.indexOf(s) : s === "UNKNOWN" ? 99 : 10);
  return rank(a) - rank(b) || a.localeCompare(b);
}

function roll(state: string, all: readonly Movement[], period: Period): Roll {
  const opening = balanceAsOf(all, addDays(period.start as IsoDate, -1));
  const inPeriod = all.filter((m) => m.date >= period.start && m.date <= period.end);
  const regular = inPeriod.filter((m) => m.priorPeriodOf === undefined);
  const priorPeriod = inPeriod.filter((m) => m.priorPeriodOf !== undefined).reduce((a, m) => a + signed(m), 0);
  const sum = (k: MovementKind) => regular.filter((m) => m.kind === k).reduce((a, m) => a + m.amountCents, 0);
  const identified = sum("identified");
  const resolved = sum("resolved");
  const clearedLate = sum("cleared_late");
  const remitted = sum("remitted");
  const closing = opening + priorPeriod + identified - resolved - clearedLate - remitted;
  return { state, opening, priorPeriod, identified, resolved, clearedLate, remitted, closing, reconciles: closing === balanceAsOf(all, period.end) };
}

export function rollForward(movements: readonly Movement[], period: Period): RollForward {
  const states = [...new Set(movements.map((m) => m.state))].sort(stateOrder);
  const perState = states.map((s) =>
    roll(
      s,
      movements.filter((m) => m.state === s),
      period,
    ),
  );
  const total = roll("Total", movements, period);
  const inPeriod = movements.filter((m) => m.date >= period.start && m.date <= period.end);
  return {
    period,
    states: perState,
    total,
    movements: inPeriod,
    anyClearedLate: movements.some((m) => m.kind === "cleared_late"),
    adjustment: adjustmentOf(inPeriod),
  };
}

export const BAR_IDS = ["opening", "prior_period", "identified", "resolved", "cleared_late", "remitted", "closing"] as const;
export type BarId = (typeof BAR_IDS)[number];

/** Items on the liability at the end of `date`, as their `identified` movements. */
export function outstandingAt(movements: readonly Movement[], date: string): Movement[] {
  const settled = new Set(movements.filter((m) => isSettlement(m.kind) && m.date <= date).map((m) => m.itemId));
  return movements.filter((m) => m.kind === "identified" && m.date <= date && !settled.has(m.itemId));
}

/** The items behind each waterfall bar: what was open at the start and end, and what moved in the period. */
export function itemsBehind(movements: readonly Movement[], period: Period): Record<BarId, Movement[]> {
  const inPeriod = movements.filter((m) => m.date >= period.start && m.date <= period.end);
  const of = (k: MovementKind) => inPeriod.filter((m) => m.kind === k && m.priorPeriodOf === undefined);
  return {
    opening: outstandingAt(movements, addDays(period.start as IsoDate, -1)),
    prior_period: inPeriod.filter((m) => m.priorPeriodOf !== undefined),
    identified: of("identified"),
    resolved: of("resolved"),
    cleared_late: of("cleared_late"),
    remitted: of("remitted"),
    closing: outstandingAt(movements, period.end),
  };
}

export function earliestDate(movements: readonly Movement[]): string | null {
  let min: string | null = null;
  for (const m of movements) if (min === null || m.date < min) min = m.date;
  return min;
}
