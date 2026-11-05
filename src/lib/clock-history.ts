/**
 * R7-04: the demo date an event happened on. Rows only carry a real wall-clock timestamp, so showing that timestamp (or
 * clamping it) puts events on the wrong calendar once the demo clock jumps. Every clock change is logged in
 * demo_clock_events, and an event is dated by the last change at or before its real timestamp.
 */
import { asc, desc, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { demoClockEvents } from "@/db/schema";
import { appendAuditEvent } from "@/lib/audit/chain-db";
import { onDemoCalendar } from "./clock-display";

export interface ClockStep {
  /** Real instant (epoch ms) the clock started showing `day`. */
  atMs: number;
  /** Demo date (YYYY-MM-DD) from then on. */
  day: string;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** What a clock change did, stored on its row (R9-02). Rows written without it keep these columns NULL ("not recorded"). */
export interface ClockEventDetails {
  kind: "move" | "reset";
  prevDay: string;
  detectedCount: number;
  detectedCents: number;
  undetectedCount: number;
}

export const clockDirection = (prevDay: string, day: string): "forward" | "back" | "same" => (day > prevDay ? "forward" : day < prevDay ? "back" : "same");

/**
 * Log that the company's demo clock now shows `day` (called by advanceClock / resetClock, or by moveDemoClock with the
 * `details` of the detection it ran). `set_at` is strictly later than the company's previous event, so two changes made
 * in the same millisecond keep their order and each date the events after it. Returns the new row's id.
 *
 * Also appends the change to the audit chain (clock.set / clock.move / clock.reset). Callers pass the transaction that
 * moved the clock, so the event row, the chain row and the move commit together.
 */
export async function recordClockDay(db: Db, companyId: string, day: string, atMs: number = Date.now(), details?: ClockEventDetails): Promise<string> {
  const [last] = await db.select({ setAt: demoClockEvents.setAt }).from(demoClockEvents).where(eq(demoClockEvents.companyId, companyId)).orderBy(desc(demoClockEvents.setAt)).limit(1);
  const at = Math.max(atMs, (last?.setAt.getTime() ?? -Infinity) + 1);
  const [row] = await db
    .insert(demoClockEvents)
    .values({
      companyId,
      demoDay: day,
      setAt: new Date(at),
      ...(details
        ? {
            kind: details.kind,
            prevDay: details.prevDay,
            direction: clockDirection(details.prevDay, day),
            detectedCount: details.detectedCount,
            detectedCents: details.detectedCents,
            undetectedCount: details.undetectedCount,
          }
        : {}),
    })
    .returning({ id: demoClockEvents.id });
  const kind = details ? `clock.${details.kind}` : "clock.set";
  await appendAuditEvent(db, {
    companyId,
    kind,
    subjectType: "demo_clock_event",
    subjectId: row!.id,
    occurredAt: new Date(at),
    payload: details
      ? {
          day,
          prevDay: details.prevDay,
          direction: clockDirection(details.prevDay, day),
          detectedCount: details.detectedCount,
          detectedCents: details.detectedCents,
          undetectedCount: details.undetectedCount,
        }
      : { day },
  });
  return row!.id;
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
