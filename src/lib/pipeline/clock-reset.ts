/**
 * Demo-clock Reset (F17). Moving the clock back to the anchor must also put statuses back where they would be on
 * the anchor date, or the dashboard shows "DD due" items and letter drafts that cannot exist yet.
 *
 * Deterministic recompute, not a snapshot: clock-driven statuses (watching, needs_rule, dd_pending, to_report) are a
 * pure function of the item's dates and "today", so each such item is restarted from the last status a PERSON moved
 * it to (a sent letter => dd_sent, an owner reply => owner_responded, else watching) and the machine is re-run at the
 * anchor. Statuses a person set directly (dd_sent, owner_responded, reported) and closed items are never touched.
 *
 * Letter drafts the machine created on a simulated date after the anchor (outreach.tracking.autoDraft.simDate) are
 * removed only while still a bare, untouched `draft`; anything a person has started on stays.
 */
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { outreach, reports, staleItems, type StaleStatus } from "@/db/schema";
import * as clock from "@/lib/clock";
import { recordClockDay } from "@/lib/clock-history";
import { compare, type IsoDate } from "@/lib/dates";
import { pruneFutureDetections } from "./clock-move";
import { TERMINAL_STATUSES, autoDraftOf } from "./compute";
import { recomputeTimelines } from "./recompute";

/** Statuses the state machine sets from dates alone (safe to recompute). */
const CLOCK_DRIVEN: ReadonlySet<StaleStatus> = new Set<StaleStatus>(["watching", "needs_rule", "dd_pending", "to_report"]);
/** Outreach states that mean a letter actually went out. */
const SENT: ReadonlySet<string> = new Set(["sent", "delivered", "responded"]);

export interface ClockResetResult {
  today: string;
  /** Items whose status was recomputed at the anchor date. */
  restored: number;
  /** Status changes made by the reset, before -> after. */
  transitions: { staleItemId: string; from: StaleStatus; to: StaleStatus }[];
  /** Untouched letter drafts the clock auto-created after the anchor, now removed. */
  removedDrafts: number;
  /** Items where something a person did (sent letter, owner reply, filed report, remittance, resolution, started draft) was kept. */
  keptHumanActions: number;
  /** Reports approved on a demo date after the anchor: kept as filed, dated in the future. */
  futureFilings: number;
  /** Remittances recorded with a date after the anchor: kept as recorded, dated in the future. */
  futureRemittances: number;
  /** R8-01: items a clock move detected that are not stale yet at the anchor (and nobody acted on), now removed. */
  undetected: number;
}

type Letter = typeof outreach.$inferSelect;

function floorStatus(item: { classification: unknown }, letters: Letter[]): StaleStatus {
  const cls = (item.classification ?? {}) as { ownerResponse?: unknown };
  if (cls.ownerResponse || letters.some((l) => l.status === "responded" || l.respondedAt)) return "owner_responded";
  if (letters.some((l) => SENT.has(l.status))) return "dd_sent";
  return "watching";
}

export async function resetDemoClock(db: Db, companyId: string): Promise<ClockResetResult> {
  // R9-02: Reset is a clock change like any other. History is never erased: the reset is logged as its own event row
  // (with the detections it removed), in the same transaction as the removal. A full demo reseed (/api/demo/reset)
  // wipes every table including this log, which that endpoint already says.
  const prevDay = await clock.now(db, companyId);
  await clock.zeroClockOffset(db, companyId);
  const today = await clock.now(db, companyId);
  const undetected = await db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    const removed = await pruneFutureDetections(t, companyId, today);
    await recordClockDay(t, companyId, today, Date.now(), { kind: "reset", prevDay, detectedCount: 0, detectedCents: 0, undetectedCount: removed });
    return removed;
  });
  const items = await db.select().from(staleItems).where(eq(staleItems.companyId, companyId));
  const letters = await db.select().from(outreach).where(eq(outreach.companyId, companyId));

  const futureDraft = (l: Letter) => {
    const mark = autoDraftOf(l.tracking);
    return mark !== null && compare(mark.simDate as IsoDate, today) > 0;
  };
  // Bare = the row the machine created and nobody touched: still "draft" AND never composed. Composing ("Draft
  // outreach", Compose all) fills the body on that same row and leaves the status at "draft", so status alone is not
  // enough to tell a person's letter from the machine's placeholder.
  const bare = (l: Letter) => l.status === "draft" && !l.body?.trim();
  const toRemove = letters.filter((l) => bare(l) && futureDraft(l)).map((l) => l.id);
  if (toRemove.length > 0) {
    await db.delete(outreach).where(and(eq(outreach.companyId, companyId), inArray(outreach.id, toRemove)));
  }
  const kept = letters.filter((l) => !toRemove.includes(l.id));
  const lettersOf = (id: string) => kept.filter((l) => l.staleItemId === id);

  const before = new Map(items.map((i) => [i.id, i.status] as const));
  const human = new Set<string>();
  let restored = 0;
  for (const item of items) {
    const own = lettersOf(item.id);
    // A post-anchor draft a person has started on (composed, approved...) is kept and counted.
    if (own.some((l) => !bare(l) && l.status !== "cancelled" && futureDraft(l))) human.add(item.id);
    if (TERMINAL_STATUSES.has(item.status)) {
      // R6-17: a remittance or a "resolved" a person recorded is kept and counted, like any other human action.
      const cls = (item.classification ?? {}) as { remittance?: unknown; resolution?: unknown };
      if (cls.remittance || cls.resolution) human.add(item.id);
      continue;
    }
    if (!CLOCK_DRIVEN.has(item.status)) {
      human.add(item.id); // dd_sent / owner_responded / reported: set by a person, never undone by the clock
      continue;
    }
    const floor = floorStatus(item, own);
    if (floor !== "watching") human.add(item.id);
    restored++;
    if (floor !== item.status) await db.update(staleItems).set({ status: floor }).where(eq(staleItems.id, item.id));
  }

  // Re-run the machine at the anchor date from each floor (also recomputes dates from the current rules).
  await recomputeTimelines(db, companyId);
  const after = await db.select({ id: staleItems.id, status: staleItems.status }).from(staleItems).where(eq(staleItems.companyId, companyId));
  const transitions = after
    .filter((a) => before.get(a.id) !== undefined && before.get(a.id) !== a.status)
    .map((a) => ({ staleItemId: a.id, from: before.get(a.id)!, to: a.status }));

  // R6-17: filings approved on a demo date after the anchor stay filed (a person did them); say so instead of hiding it.
  const filed = await db.select({ filingRecord: reports.filingRecord }).from(reports).where(eq(reports.companyId, companyId));
  const futureFilings = filed.filter((r) => {
    const asOf = (r.filingRecord as { asOf?: unknown } | null)?.asOf;
    return typeof asOf === "string" && compare(asOf as IsoDate, today) > 0;
  }).length;

  const futureRemittances = items.filter((i) => {
    const on = ((i.classification ?? {}) as { remittance?: { remittedOn?: unknown } }).remittance?.remittedOn;
    return typeof on === "string" && compare(on as IsoDate, today) > 0;
  }).length;

  return { today, restored, transitions, removedDrafts: toRemove.length, keptHumanActions: human.size, futureFilings, futureRemittances, undetected };
}
