/** Layout model for the what-if timeline (pure): lanes per event kind, marks grouped by lane and date. */
import { compare, diffDays, type IsoDate } from "@/lib/dates";
import { MAX_OFFSET, type EventKind, type TimelineEvent } from "./types";

export const LANES: readonly { kind: EventKind; label: string }[] = [
  { kind: "presumed_abandoned", label: "Presumed abandoned" },
  { kind: "dd_window_start", label: "DD window opens" },
  { kind: "dd_window_end", label: "DD window closes" },
  { kind: "report_due", label: "Report due" },
  { kind: "remit_due", label: "Remit due" },
];

export interface TimelineMark {
  key: string;
  lane: number;
  kind: EventKind;
  date: string;
  /** Days from today; an already-late date (before today) pins to 0 with `late`. */
  day: number;
  late: boolean;
  count: number;
  cents: number;
  /** Every event in the group was missed (obligations not performed by their date). */
  missed: number;
  met: number;
  crossing: number;
  unverified: boolean;
}

export function buildMarks(events: readonly TimelineEvent[], today: IsoDate): TimelineMark[] {
  const by = new Map<string, TimelineMark>();
  for (const e of events) {
    if (e.outcome === "moot") continue;
    const lane = LANES.findIndex((l) => l.kind === e.kind);
    const late = compare(e.date as IsoDate, today) < 0;
    const day = late ? 0 : Math.min(MAX_OFFSET, diffDays(today, e.date as IsoDate));
    const key = `${e.kind}:${late ? "late" : e.date}`;
    const cur = by.get(key) ?? { key, lane, kind: e.kind, date: e.date, day, late, count: 0, cents: 0, missed: 0, met: 0, crossing: 0, unverified: false };
    by.set(key, {
      ...cur,
      count: cur.count + 1,
      cents: cur.cents + e.amountCents,
      missed: cur.missed + (e.outcome === "missed" ? 1 : 0),
      met: cur.met + (e.outcome === "met" ? 1 : 0),
      crossing: cur.crossing + (e.outcome === "crossing" ? 1 : 0),
      unverified: cur.unverified || e.unverified,
    });
  }
  return [...by.values()].sort((a, b) => a.day - b.day || a.lane - b.lane);
}

/** Is the mark reached at the cursor? Obligations count as missed only strictly AFTER their date (src/lib/overdue.ts). */
export function markState(m: TimelineMark, offset: number): "hidden" | "missed" | "met" | "crossing" {
  if (!m.late && m.day > offset) return "hidden";
  if (m.missed > 0 && (m.late || m.day < offset)) return "missed";
  if (m.met > 0 && m.missed === 0) return "met";
  // A crossing, or an obligation due exactly at the cursor (due today is not late).
  return "crossing";
}
