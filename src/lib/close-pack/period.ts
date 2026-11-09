/** Month periods for the close pack. A month ends on its last day, or on the demo date when that comes first ("to date"). Pure. */
import { daysInMonth } from "@/lib/dates";
import type { Period } from "@/lib/ledger/rollforward";
import type { Movement } from "@/lib/ledger/movements";

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

export const isMonthId = (s: string): boolean => MONTH_RE.test(s);

export const monthLabel = (ym: string): string => `${MONTHS[Number(ym.slice(5, 7)) - 1] ?? ym.slice(5, 7)} ${ym.slice(0, 4)}`;

export type MonthResult = { ok: true; period: Period } | { ok: false; error: string };

/** The first month with any ledger movement (YYYY-MM), or the demo month when there are none. */
export function firstActivityMonth(movements: readonly Pick<Movement, "date">[], today: string): string {
  let first = today.slice(0, 7);
  for (const m of movements) if (m.date.slice(0, 7) < first) first = m.date.slice(0, 7);
  return first;
}

/**
 * The ledger Period for "YYYY-MM" on demo date `today`. A month that has not started yet is refused, never faked; so is
 * a month before `firstMonth` (R10-09), when there is no data to close.
 */
export function monthPeriod(ym: string, today: string, firstMonth?: string | null): MonthResult {
  const m = MONTH_RE.exec(ym);
  if (!m) return { ok: false, error: "period must be YYYY-MM" };
  const start = `${ym}-01`;
  if (start > today) return { ok: false, error: `${monthLabel(ym)} has not started on the demo clock (${today})` };
  if (firstMonth && ym < firstMonth) return { ok: false, error: `No activity before ${monthLabel(firstMonth)}: ${monthLabel(ym)} has nothing to close` };
  const last = `${ym}-${String(daysInMonth(Number(m[1]), Number(m[2]))).padStart(2, "0")}`;
  return { ok: true, period: { id: "month", label: monthLabel(ym), start, end: last < today ? last : today } };
}

/** Months (newest first) that have ledger movements on or before `today`, plus the current demo month. */
export function monthsWithActivity(movements: readonly Pick<Movement, "date">[], today: string): string[] {
  const set = new Set<string>([today.slice(0, 7)]);
  for (const m of movements) if (m.date <= today) set.add(m.date.slice(0, 7));
  return [...set].sort().reverse();
}
