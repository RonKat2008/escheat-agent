/**
 * R7-04: the demo date an event happened on. Rows only carry a real wall-clock timestamp, so showing that timestamp (or
 * clamping it) puts events on the wrong calendar once the demo clock jumps. Every clock change is logged in
 * demo_clock_events, and an event is dated by the last change at or before its real timestamp.
 */
import { asc, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { demoClockEvents } from "@/db/schema";
import { onDemoCalendar } from "./clock-display";

export interface ClockStep {
  /** Real instant (epoch ms) the clock started showing `day`. */
  atMs: number;
  /** Demo date (YYYY-MM-DD) from then on. */
  day: string;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Log that the company's demo clock now shows `day` (called by advanceClock / resetClock). */
export async function recordClockDay(db: Db, companyId: string, day: string, atMs: number = Date.now()): Promise<void> {
  await db.insert(demoClockEvents).values({ companyId, demoDay: day, setAt: new Date(atMs) });
}

/** The company's clock changes, oldest first. */
export async function loadClockHistory(db: Db, companyId: string): Promise<ClockStep[]> {
  const rows = await db
    .select({ demoDay: demoClockEvents.demoDay, setAt: demoClockEvents.setAt })
    .from(demoClockEvents)
    .where(eq(demoClockEvents.companyId, companyId))
    .orderBy(asc(demoClockEvents.setAt));
  return rows.map((r) => ({ atMs: r.setAt.getTime(), day: r.demoDay }));
}

/**
 * The demo date a real timestamp belongs to: the day the clock showed at that instant. A bare date is already a
 * demo/calendar date and is returned unchanged. An event before the first logged change is clamped to that first demo
 * day (or today, if earlier); with no history at all, fall back to the legacy clamp against today's demo date.
 */
export function demoDayAt(iso: string | null | undefined, history: readonly ClockStep[], today: string): string | null {
  if (!iso) return null;
  if (DAY_RE.test(iso)) return iso;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return onDemoCalendar(iso, today);
  let hit: ClockStep | undefined;
  for (const step of history) {
    if (step.atMs <= ms) hit = step;
    else break;
  }
  if (hit) return hit.day;
  // R8-09: before the first logged change (the seed writes its rows, then sets the clock), the event happened on or
  // before the first logged demo day, never on a later real date. Clamp to that day, not to today.
  const first = history[0];
  return onDemoCalendar(iso, first && first.day < today ? first.day : today);
}
