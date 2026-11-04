import { demoDayAt, type ClockStep } from "@/lib/clock-history";

/**
 * R7-04: the demo dates the entries of one real-clock day group happened on, newest first, de-duplicated. The feed is
 * still grouped by real day (filters, the strip and its links are real-day based); only the label is on the demo
 * calendar, and a jump of the demo clock inside one real day shows every demo date it covers.
 */
export function groupDemoDays(entries: readonly { at: Date }[], history: readonly ClockStep[], demoToday: string): string[] {
  const out: string[] = [];
  for (const e of entries) {
    const d = demoDayAt(e.at.toISOString(), history, demoToday);
    if (d && !out.includes(d)) out.push(d);
  }
  return out;
}
