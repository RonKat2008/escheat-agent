/**
 * UTC-safe calendar-date helpers. Dates are plain YYYY-MM-DD strings (branded `IsoDate`);
 * no local-timezone Date parsing is ever used, so there is no TZ drift.
 */

export type IsoDate = string & { readonly __brand: "IsoDate" };

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

export interface YMD {
  y: number;
  m: number; // 1-12
  d: number; // 1-31
}

export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInMonth(y: number, m: number): number {
  if (m === 2) return isLeapYear(y) ? 29 : 28;
  return [4, 6, 9, 11].includes(m) ? 30 : 31;
}

/** True only for a real calendar date written as YYYY-MM-DD. */
export function isIsoDate(value: unknown): value is IsoDate {
  if (typeof value !== "string") return false;
  const m = ISO_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo);
}

/** Validate and brand. Throws RangeError on a malformed or non-existent date. */
export function parseIsoDate(value: string): IsoDate {
  if (!isIsoDate(value)) throw new RangeError(`Invalid ISO date: ${JSON.stringify(value)}`);
  return value;
}

export function toYMD(date: IsoDate): YMD {
  const m = ISO_RE.exec(date);
  if (!m) throw new RangeError(`Invalid ISO date: ${date}`);
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

const pad = (n: number, w: number) => String(n).padStart(w, "0");

/** Build an IsoDate from parts. Day is clamped to the month's length. */
export function fromYMD(y: number, m: number, d: number): IsoDate {
  const day = Math.min(d, daysInMonth(y, m));
  return `${pad(y, 4)}-${pad(m, 2)}-${pad(day, 2)}` as IsoDate;
}

function toUtcMs(date: IsoDate): number {
  const { y, m, d } = toYMD(date);
  const dt = new Date(0);
  dt.setUTCFullYear(y, m - 1, d);
  dt.setUTCHours(0, 0, 0, 0);
  return dt.getTime();
}

function fromUtcMs(ms: number): IsoDate {
  const dt = new Date(ms);
  return fromYMD(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

/** The UTC calendar date of a JS Date. */
export function fromDate(date: Date): IsoDate {
  return fromYMD(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

/** Midnight UTC of the given date. */
export function toDate(date: IsoDate): Date {
  return new Date(toUtcMs(date));
}

/** Today's date in UTC (real clock). For the demo clock use `src/lib/clock.ts`. */
export function todayUtc(): IsoDate {
  return fromDate(new Date());
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return fromUtcMs(toUtcMs(date) + days * MS_PER_DAY);
}

/** Add calendar months; the day is clamped to the target month's end (Jan 31 + 1m = Feb 28/29). */
export function addMonths(date: IsoDate, months: number): IsoDate {
  const { y, m, d } = toYMD(date);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = total - ny * 12 + 1;
  return fromYMD(ny, nm, d);
}

/** Add calendar years; Feb 29 + 1y = Feb 28 (clamped). */
export function addYears(date: IsoDate, years: number): IsoDate {
  return addMonths(date, years * 12);
}

/** Whole days from `a` to `b` (positive when b is after a). */
export function diffDays(a: IsoDate, b: IsoDate): number {
  return Math.round((toUtcMs(b) - toUtcMs(a)) / MS_PER_DAY);
}

export function compare(a: IsoDate, b: IsoDate): -1 | 0 | 1 {
  // ISO strings of equal width sort lexicographically; years are always 4 digits.
  return a < b ? -1 : a > b ? 1 : 0;
}

export const isBefore = (a: IsoDate, b: IsoDate) => compare(a, b) < 0;
export const isAfter = (a: IsoDate, b: IsoDate) => compare(a, b) > 0;

export function maxDate(a: IsoDate, b: IsoDate): IsoDate {
  return compare(a, b) >= 0 ? a : b;
}

/** 0 = Sunday ... 6 = Saturday. */
export function dayOfWeek(date: IsoDate): number {
  return new Date(toUtcMs(date)).getUTCDay();
}

export function isWeekend(date: IsoDate): boolean {
  const dow = dayOfWeek(date);
  return dow === 0 || dow === 6;
}

/**
 * The first business day on or after `date`: weekends and any listed holidays roll forward.
 * (A date that is already a business day is returned unchanged.)
 */
export function nextBusinessDay(date: IsoDate, holidays: readonly string[] = []): IsoDate {
  const hol = new Set(holidays);
  let cur = date;
  // Bounded loop: at most a long weekend plus a run of consecutive holidays.
  for (let i = 0; i < 400; i++) {
    if (!isWeekend(cur) && !hol.has(cur)) return cur;
    cur = addDays(cur, 1);
  }
  throw new RangeError("nextBusinessDay: holiday list leaves no business day within 400 days");
}
