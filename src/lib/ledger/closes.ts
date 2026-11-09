/**
 * Closed books (R10-01, R11-01, R11-04). Pure.
 *
 * FIRST-CLOSE RULE (R11-04): the first close may be any month with activity. Closing it also closes everything dated
 * before it: those months become the frozen opening balance (the demo data starts in 2024; nobody should have to
 * close two years of months one by one to close October). After that, months close strictly IN ORDER: the only
 * closable month is the earliest month after the last close that has activity (empty months in between are skipped
 * and fall inside the next close). So the closed books are always one contiguous span, "closed through <month>".
 *
 * A close stores `covered`: every movement on the books through the period end at the moment of the close, with the
 * date it posted on. From then on, `applyCloses`:
 *   - keeps every covered movement on its frozen date, so the closed span's balances never change;
 *   - moves any movement dated inside the closed span that the closes did NOT cover (a backdated import, a late
 *     detection, a settlement dated back after the clock moved) to the first day of the earliest open month, flagged
 *     `priorPeriodOf` = the closed month it is dated in. The roll-forward shows it as its own "Prior-period adjustment"
 *     line and the journal posts it as a labelled "-PPA-" entry, so the next month's opening = the frozen closing.
 * Applying this to the movements before the roll-forward and journal are built keeps both in agreement.
 *
 * Closes recorded before R11-01 have no `covered`: only their own month's frozen entries count as covered and months
 * before them are left as they were (the R10-01 behaviour), so an existing close does not suddenly restate history.
 */
import { finalizeJournal, sortEntries, type Journal, type JournalEntry } from "./journal";
import type { Movement } from "./movements";

/** Coverage map: `${itemId}|${kind}` → the date it posted on, or `${date}|${priorPeriodOf}` for an adjustment. */
export type Coverage = Record<string, string>;

export interface ClosedPeriod {
  /** "YYYY-MM". */
  period: string;
  /** The month's journal entries exactly as closed. */
  entries: JournalEntry[];
  /** Every movement on the books through the period end at close (R11-01); absent for closes recorded before it. */
  covered?: Coverage | null;
}

const coverKey = (itemId: string, kind: string) => `${itemId}|${kind}`;

export function nextMonth(ym: string): string {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7));
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

export function lastDayOf(ym: string): string {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7));
  return `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
}

/** The first month after `ym` that has not been closed. */
export function nextOpenMonth(ym: string, closed: ReadonlySet<string>): string {
  let next = nextMonth(ym);
  while (closed.has(next)) next = nextMonth(next);
  return next;
}

/** The last closed month ("closed through"), or null when nothing is closed. */
export function closedThrough(periods: readonly string[]): string | null {
  return periods.length === 0 ? null : [...periods].sort().at(-1)!;
}

/** What a close of a month ending `periodEnd` covers: every movement dated on or before it, as posted. */
export function coverageOf(movements: readonly Movement[], periodEnd: string): Coverage {
  const out: Coverage = {};
  for (const m of movements) {
    if (m.date > periodEnd) continue;
    out[coverKey(m.itemId, m.kind)] = m.priorPeriodOf ? `${m.date}|${m.priorPeriodOf}` : m.date;
  }
  return out;
}

function frozenAs(m: Movement, posted: string): Movement {
  const [date, pp] = posted.split("|") as [string, string | undefined];
  const rest: Movement = { ...m, date };
  delete rest.priorPeriodOf;
  return pp ? { ...rest, priorPeriodOf: pp } : rest;
}

export function applyCloses(movements: readonly Movement[], closes: readonly ClosedPeriod[]): Movement[] {
  if (closes.length === 0) return [...movements];
  const closedMonths = new Set(closes.map((c) => c.period));
  const through = closedThrough([...closedMonths])!;
  const throughEnd = lastDayOf(through);
  const target = `${nextOpenMonth(through, closedMonths)}-01`;
  const covered = new Map<string, string>();
  for (const c of [...closes].sort((a, b) => a.period.localeCompare(b.period))) for (const [k, v] of Object.entries(c.covered ?? {})) covered.set(k, v);
  const legacy = closes.filter((c) => !c.covered);
  const legacyCovered = new Map(legacy.map((c) => [c.period, new Set(c.entries.flatMap((e) => e.itemIds.map((id) => coverKey(id, e.kind))))]));
  const legacyFloor = closedThrough(legacy.map((c) => c.period));
  return movements.map((m) => {
    if (m.date > throughEnd) return m;
    const key = coverKey(m.itemId, m.kind);
    const posted = covered.get(key);
    if (posted !== undefined) return frozenAs(m, posted);
    const month = m.date.slice(0, 7);
    if (legacyCovered.get(month)?.has(key)) return m;
    if (legacyFloor && month < legacyFloor && !closedMonths.has(month)) return m;
    return { ...m, date: target, priorPeriodOf: month };
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
  const kept = journal.entries.filter((e) => !closedMonths.has(e.date.slice(0, 7)));
  const frozen = closes.flatMap((c) => c.entries).filter((e) => e.date >= start && e.date <= end);
  return finalizeJournal(sortEntries([...kept, ...frozen]));
}

export type CloseOrder = { ok: true } | { ok: false; nextClosable: string | null; reason: "inside_closed" | "out_of_order" };

/**
 * R11-04: the month that may be closed next. With nothing closed, any month with activity (the first close). After
 * that, the earliest month after the last close that has activity (`activity` = months with movements, plus the demo
 * month), or null when there is none yet.
 */
export function nextClosableMonth(closed: readonly string[], activity: readonly string[]): string | null {
  const through = closedThrough(closed);
  if (!through) return null;
  return [...activity].filter((m) => m > through).sort()[0] ?? null;
}

/** Whether `period` may be closed now under the in-order rule (pure; the close route enforces it, the UI explains it). */
export function closeOrder(period: string, closed: readonly string[], activity: readonly string[]): CloseOrder {
  const through = closedThrough(closed);
  if (!through) return { ok: true };
  const next = nextClosableMonth(closed, activity);
  if (period <= through) return { ok: false, nextClosable: next, reason: "inside_closed" };
  if (period !== next) return { ok: false, nextClosable: next, reason: "out_of_order" };
  return { ok: true };
}
