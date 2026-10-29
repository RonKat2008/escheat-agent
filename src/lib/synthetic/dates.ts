/** Minimal UTC calendar-day helpers on 'YYYY-MM-DD' strings (generator-local). */

const MS_PER_DAY = 86_400_000;

export function dayNumber(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return Math.round(Date.UTC(y, m - 1, d) / MS_PER_DAY);
}

export function fromDayNumber(n: number): string {
  return new Date(n * MS_PER_DAY).toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  return fromDayNumber(dayNumber(iso) + days);
}

/** Whole days from a to b (b - a). */
export function daysBetween(a: string, b: string): number {
  return dayNumber(b) - dayNumber(a);
}

/** 0 = Sunday ... 6 = Saturday. */
export function weekday(iso: string): number {
  return (((dayNumber(iso) + 4) % 7) + 7) % 7;
}

/** Move a weekend date to the following Monday. */
export function nextBusinessDay(iso: string): string {
  const w = weekday(iso);
  if (w === 6) return addDays(iso, 2);
  if (w === 0) return addDays(iso, 1);
  return iso;
}

/** Move a weekend date to the preceding Friday. */
export function prevBusinessDay(iso: string): string {
  const w = weekday(iso);
  if (w === 6) return addDays(iso, -1);
  if (w === 0) return addDays(iso, -2);
  return iso;
}

/** Subtract whole calendar months, clamping the day to the target month's length. */
export function subMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) - months;
  const ny = Math.floor(total / 12);
  const nm = total % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return `${ny}-${String(nm + 1).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}
