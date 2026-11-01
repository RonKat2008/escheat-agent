import type { ActivityDensity } from "@/lib/queries/activity";

/** Minimum visible bar so a single entry next to a busy day still reads as "something happened". */
export const MIN_BAR_PCT = 14;

/** Bar height as a percent of the strip: square-root scale so one busy day does not flatten the rest. 0 for no entries. */
export function barHeightPct(count: number, max: number): number {
  if (count <= 0 || max <= 0) return 0;
  const pct = Math.sqrt(Math.min(count, max) / max) * 100;
  return Math.round(Math.max(MIN_BAR_PCT, pct) * 10) / 10;
}

/** Is an ISO day inside an optional inclusive [from, to] range? No bounds means everything is in range. */
export function inRange(day: string, from?: string, to?: string): boolean {
  if (from && day < from) return false;
  if (to && day > to) return false;
  return true;
}

/** One sentence under the strip heading: the busiest day, or why the strip is empty. */
export function stripCaption(d: Pick<ActivityDensity, "total" | "peak" | "days">, fmt: (iso: string) => string): string {
  if (d.total === 0 || !d.peak) return "Nothing recorded in this window.";
  const active = d.days.filter((x) => x.count > 0).length;
  const attention = d.days.reduce((a, x) => a + x.attention, 0);
  const busiest = active === 1 ? `All on ${fmt(d.peak.day)}` : `Busiest ${fmt(d.peak.day)} with ${d.peak.count}`;
  return attention > 0 ? `${busiest}. ${attention} need${attention === 1 ? "s" : ""} attention.` : `${busiest}.`;
}
