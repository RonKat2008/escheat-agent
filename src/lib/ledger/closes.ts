/**
 * R10-01: closed months. A close freezes a month's journal entries (stored by closePeriod). From then on:
 *   - movements the close covered stay in that month, and the month's entries are the frozen ones, verbatim;
 *   - a movement dated in the closed month that the close did NOT cover (an item detected later and backdated) is moved
 *     to the first open month after it, dated its first day, and flagged `priorPeriodOf`, so the journal posts it as a
 *     labelled prior-period adjustment instead of rewriting the closed month.
 * Applying this to the movements before the roll-forward and journal are built keeps both in agreement. Pure.
 */
import { finalizeJournal, sortEntries, type Journal, type JournalEntry } from "./journal";
import type { Movement } from "./movements";

export interface ClosedPeriod {
  /** "YYYY-MM". */
  period: string;
  /** The month's journal entries exactly as closed. */
  entries: JournalEntry[];
}

const coverKey = (itemId: string, kind: string) => `${itemId}|${kind}`;

function nextMonth(ym: string): string {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7));
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

/** The first month after `ym` that has not been closed. */
export function nextOpenMonth(ym: string, closed: ReadonlySet<string>): string {
  let next = nextMonth(ym);
  while (closed.has(next)) next = nextMonth(next);
  return next;
}

export function applyCloses(movements: readonly Movement[], closes: readonly ClosedPeriod[]): Movement[] {
  if (closes.length === 0) return [...movements];
  const closedMonths = new Set(closes.map((c) => c.period));
  const covered = new Map(closes.map((c) => [c.period, new Set(c.entries.flatMap((e) => e.itemIds.map((id) => coverKey(id, e.kind))))]));
  return movements.map((m) => {
    const month = m.date.slice(0, 7);
    if (!closedMonths.has(month) || covered.get(month)!.has(coverKey(m.itemId, m.kind))) return m;
    return { ...m, date: `${nextOpenMonth(month, closedMonths)}-01`, priorPeriodOf: month };
  });
}

/**
 * Replace the entries derived for closed months with the frozen ones, limited to the period [start, end]. Derived
 * entries in a closed month are exactly the covered movements, so this only guarantees the JE numbers, dates and lines
 * stay as they were handed out.
 */
export function withFrozenEntries(journal: Journal, closes: readonly ClosedPeriod[], start: string, end: string): Journal {
  if (closes.length === 0) return journal;
  const closedMonths = new Set(closes.map((c) => c.period));
  const kept = journal.entries.filter((e) => e.priorPeriodOf !== undefined || !closedMonths.has(e.date.slice(0, 7)));
  const frozen = closes.flatMap((c) => c.entries).filter((e) => e.date >= start && e.date <= end);
  return finalizeJournal(sortEntries([...kept, ...frozen]));
}
