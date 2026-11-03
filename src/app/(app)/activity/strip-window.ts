/**
 * Pure windowing for the activity strip. The server always loads a 30-day run of days; this picks what to draw:
 *  - nothing recorded: empty
 *  - every entry on one day (a demo seed, all on the real clock): that one day, bucketed by hour
 *  - otherwise the active range only (empty edges dropped), with long empty interior stretches collapsed into one
 *    labelled gap so the compression is visible rather than silent.
 */
import type { SeismoDay } from "./density-model";

/** An empty stretch at least this long is collapsed into a gap marker. */
export const MIN_GAP_DAYS = 3;

export interface GapItem {
  type: "gap";
  from: string;
  to: string;
  days: number;
}
export interface DayItem {
  type: "day";
  cell: SeismoDay;
}
export type StripItem = DayItem | GapItem;

export type StripPlan =
  | { mode: "empty" }
  | { mode: "hours"; day: string }
  | { mode: "days"; from: string; to: string; items: StripItem[]; quietDays: number };

export function planStrip(days: readonly SeismoDay[]): StripPlan {
  const first = days.findIndex((d) => d.count > 0);
  if (first < 0) return { mode: "empty" };
  const last = days.findLastIndex((d) => d.count > 0);
  if (first === last) return { mode: "hours", day: days[first]!.day };

  const active = days.slice(first, last + 1);
  const items: StripItem[] = [];
  let quietDays = 0;
  for (let i = 0; i < active.length; ) {
    const d = active[i]!;
    if (d.count > 0) {
      items.push({ type: "day", cell: d });
      i += 1;
      continue;
    }
    let j = i;
    while (j < active.length && active[j]!.count === 0) j += 1;
    const run = active.slice(i, j);
    if (run.length >= MIN_GAP_DAYS) {
      items.push({ type: "gap", from: run[0]!.day, to: run.at(-1)!.day, days: run.length });
      quietDays += run.length;
    } else {
      for (const r of run) items.push({ type: "day", cell: r });
    }
    i = j;
  }
  return { mode: "days", from: active[0]!.day, to: active.at(-1)!.day, items, quietDays };
}

/** The words after the entry count in the strip heading: the window and how it is aggregated. */
export function stripHeading(plan: Exclude<StripPlan, { mode: "empty" }>, fmt: (iso: string) => string): string {
  return plan.mode === "hours" ? `entries on ${fmt(plan.day)}, by hour` : `entries from ${fmt(plan.from)} to ${fmt(plan.to)}, by day`;
}

export const hourLabel = (hour: number): string => `${String(hour).padStart(2, "0")}:00`;

/** Busiest hour (UTC) and how many entries need attention, for the hourly view. */
export function hourCaption(hours: readonly SeismoDay[]): string {
  const peak = hours.reduce<SeismoDay | null>((best, h) => (h.count > (best?.count ?? 0) ? h : best), null);
  if (!peak || peak.hour == null) return "Nothing recorded in this window.";
  const attention = hours.reduce((a, h) => a + h.attention, 0);
  const busiest = `Busiest hour ${hourLabel(peak.hour)} UTC with ${peak.count}.`;
  return attention > 0 ? `${busiest} ${attention} need${attention === 1 ? "s" : ""} attention.` : busiest;
}

/** Sentence fragment naming compressed quiet days, or null. */
export function quietNote(quietDays: number): string | null {
  return quietDays > 0 ? `${quietDays} quiet ${quietDays === 1 ? "day" : "days"} compressed.` : null;
}
