/**
 * Pure layout for the deadline river (DESIGN-V3 §4.5, §6.7). No React, so it is unit-tested directly.
 *
 * The river is a horizontal time axis from the demo clock's today to the end of the window. Every engine date in the
 * window becomes part of a day column; a column stacks one segment per event kind (fixed kind order, bottom up), and a
 * segment's height grows with the number of items behind it. Dates are never computed here: they arrive from the
 * rules engine via the forecast, and anything outside [asOf, end) is dropped, not clamped.
 */
import { daysBetween, isoFromDay, dayNumber } from "@/components/viz/core/scales";

export const RIVER_KINDS = ["presumed_abandoned", "dd_window_opens", "report_due", "remit_due"] as const;
export type RiverKind = (typeof RIVER_KINDS)[number];

/** Days, counted from today inclusive, that make up the "needs you now" window (pink). */
export const URGENT_DAYS = 7;

export interface RiverEvent {
  /** YYYY-MM-DD from the rules engine. */
  date: string;
  kind: RiverKind;
  state: string;
  amountCents: number;
  verified: boolean;
}

export interface RiverSegment {
  kind: RiverKind;
  count: number;
  cents: number;
  /** States behind the segment, sorted. */
  states: string[];
  /** Every event in the segment rests on verified rule values. */
  verified: boolean;
  /** Pixel offsets from the baseline (y0 < y1; drawn upward). */
  y0: number;
  y1: number;
}

export interface RiverColumn {
  date: string;
  x: number;
  daysUntil: number;
  /** Inside the pink window: today through today + URGENT_DAYS. */
  urgent: boolean;
  segments: RiverSegment[];
  /** Total stacked height in px. */
  height: number;
  count: number;
}

export interface RiverTick {
  /** YYYY-MM */
  month: string;
  x: number;
  date: string;
}

export interface RiverLayout {
  start: string;
  /** Exclusive. */
  end: string;
  days: number;
  width: number;
  pxPerDay: number;
  todayX: number;
  /** The pink window as [x0, x1] in px. */
  window: [number, number];
  columns: RiverColumn[];
  ticks: RiverTick[];
  maxHeight: number;
  /** Events that fell outside the window and were left out. */
  dropped: number;
}

export interface RiverOptions {
  asOf: string;
  /** Exclusive end of the window (YYYY-MM-DD). */
  end: string;
  pxPerDay?: number;
  /** Height of a single-item segment in px. */
  unit?: number;
  /** Extra px per additional item (square-root scaled). */
  growth?: number;
  /** Ceiling on a single segment's height in px. */
  maxSegment?: number;
}

const KIND_INDEX: Record<RiverKind, number> = { presumed_abandoned: 0, dd_window_opens: 1, report_due: 2, remit_due: 3 };

/** Is `date` within today .. today + URGENT_DAYS (both inclusive)? Past dates are never urgent here: they are overdue. */
export function inUrgentWindow(date: string, asOf: string, days = URGENT_DAYS): boolean {
  const d = daysBetween(asOf, date);
  return d >= 0 && d <= days;
}

/** Segment height: `unit` for one item, growing with the square root of the count, capped. */
export function segmentHeight(count: number, unit = 6, growth = 5, max = 40): number {
  if (count <= 0) return 0;
  return Math.min(max, Math.round((unit + growth * (Math.sqrt(count) - 1)) * 10) / 10);
}

/** First-of-month ticks strictly after `start` and before `end`, plus `start` itself. */
export function monthTicks(start: string, end: string, x: (iso: string) => number): RiverTick[] {
  const ticks: RiverTick[] = [{ month: start.slice(0, 7), x: x(start), date: start }];
  let y = Number(start.slice(0, 4));
  let m = Number(start.slice(5, 7));
  for (;;) {
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    const iso = `${y}-${String(m).padStart(2, "0")}-01`;
    if (iso >= end) break;
    ticks.push({ month: iso.slice(0, 7), x: x(iso), date: iso });
  }
  return ticks;
}

export function layoutRiver(events: readonly RiverEvent[], opts: RiverOptions): RiverLayout {
  const pxPerDay = opts.pxPerDay ?? 6;
  const unit = opts.unit ?? 6;
  const growth = opts.growth ?? 5;
  const maxSegment = opts.maxSegment ?? 40;
  const start = opts.asOf;
  const days = Math.max(1, daysBetween(start, opts.end));
  const x = (iso: string) => (daysBetween(start, iso) + 0.5) * pxPerDay;

  const byDay = new Map<string, Map<RiverKind, { count: number; cents: number; states: Set<string>; verified: boolean }>>();
  let dropped = 0;
  for (const e of events) {
    const d = daysBetween(start, e.date);
    if (!Number.isFinite(d) || d < 0 || d >= days) {
      dropped += 1;
      continue;
    }
    const day = isoFromDay(dayNumber(e.date));
    const kinds = byDay.get(day) ?? new Map();
    const seg = kinds.get(e.kind) ?? { count: 0, cents: 0, states: new Set<string>(), verified: true };
    seg.count += 1;
    seg.cents += e.amountCents;
    seg.states.add(e.state);
    seg.verified = seg.verified && e.verified;
    kinds.set(e.kind, seg);
    byDay.set(day, kinds);
  }

  const columns: RiverColumn[] = [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, kinds]) => {
      let y = 0;
      const segments: RiverSegment[] = [...kinds.entries()]
        .sort(([a], [b]) => KIND_INDEX[a] - KIND_INDEX[b])
        .map(([kind, s]) => {
          const h = segmentHeight(s.count, unit, growth, maxSegment);
          const seg: RiverSegment = { kind, count: s.count, cents: s.cents, states: [...s.states].sort(), verified: s.verified, y0: y, y1: y + h };
          y += h + 1; // 1px seam between stacked kinds
          return seg;
        });
      const height = segments.length ? segments.at(-1)!.y1 : 0;
      return {
        date,
        x: x(date),
        daysUntil: daysBetween(start, date),
        urgent: inUrgentWindow(date, start),
        segments,
        height,
        count: segments.reduce((a, s) => a + s.count, 0),
      };
    });

  return {
    start,
    end: opts.end,
    days,
    width: days * pxPerDay,
    pxPerDay,
    todayX: x(start) - pxPerDay / 2,
    window: [0, Math.min(days, URGENT_DAYS + 1) * pxPerDay],
    columns,
    ticks: monthTicks(start, opts.end, (iso) => x(iso) - pxPerDay / 2),
    maxHeight: columns.reduce((a, c) => Math.max(a, c.height), 0),
    dropped,
  };
}
