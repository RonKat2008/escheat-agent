/**
 * Real wall-clock timestamps (a send, a run) are shown on the demo calendar: a day that has not happened yet on the
 * demo clock is shown as the demo date. ISO dates compare lexically, so no Date parsing (and no timezone) is involved.
 */
export function onDemoCalendar(iso: string | null | undefined, today: string): string | null {
  if (!iso) return null;
  const day = iso.slice(0, 10);
  return day > today ? today : day;
}
