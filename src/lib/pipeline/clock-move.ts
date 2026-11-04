/**
 * R8-01: moving the demo clock is one deterministic step, so every surface reads the same liability afterwards.
 *
 *   1. move the clock (logged in demo_clock_events),
 *   2. drop clock-detected items whose stale date is now in the future again (only while nobody has acted on them),
 *   3. run stale detection for ledger items that crossed the business stale line (new items only, heuristic classifier,
 *      no model call), stamped classification.detectedBy = "clock",
 *   4. recompute every timeline at the new "today".
 *
 * Dashboard, Items, Ledger and chat all read stale_items, and Horizon's "awaiting detection" count is the set of
 * crossed items NOT in stale_items, so after this step it is 0 and the totals agree. Running it twice at the same date
 * changes nothing (detection skips items already in the pipeline; prune only removes future-dated ones).
 */
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { outreach, staleItems, type StaleStatus } from "@/db/schema";
import { heuristicClassify, type Classification, type ClassifyContext } from "@/lib/agents/classifier";
import type { ClassifierItem } from "@/lib/agents/types";
import * as clock from "@/lib/clock";
import { compare, type IsoDate } from "@/lib/dates";
import { detectStaleItems } from "./detect";
import { recomputeTimelines, type Transition } from "./recompute";

/** Statuses the machine sets from dates alone; anything else means a person moved the item. */
const CLOCK_DRIVEN: ReadonlySet<StaleStatus> = new Set<StaleStatus>(["watching", "needs_rule", "dd_pending", "to_report"]);

export interface ClockDetection {
  /** Items newly detected as stale by this move. */
  count: number;
  cents: number;
  byState: Record<string, number>;
}

export interface ClockMoveResult {
  today: string;
  offsetDays: number;
  detected: ClockDetection;
  /** Clock-detected items removed because the clock moved back before their stale date. */
  undetected: number;
  transitions: Transition[];
  deadlinesMoved: number;
}

/** Deterministic, offline classification for clock-driven detection (labeled "heuristic", never a model result). */
export async function heuristicBatch(items: readonly ClassifierItem[], opts: { ctx: ClassifyContext }): Promise<Classification[]> {
  return items.map((item) => heuristicClassify(item, { ...opts.ctx, subjectId: opts.ctx.subjectId ?? item.number ?? undefined }));
}

export function isClockDetected(classification: unknown): boolean {
  return (classification as { detectedBy?: unknown } | null)?.detectedBy === "clock";
}

/**
 * Remove clock-detected items whose stale date is after `today` (the clock moved back), unless a person acted on them:
 * a non-clock status, a letter beyond a bare machine draft, a remittance or a resolution. Returns how many were removed.
 */
export async function pruneFutureDetections(db: Db, companyId: string, today: string): Promise<number> {
  const rows = await db.select().from(staleItems).where(eq(staleItems.companyId, companyId));
  const candidates = rows.filter((r) => isClockDetected(r.classification) && compare(r.staleSince as IsoDate, today as IsoDate) > 0);
  if (candidates.length === 0) return 0;
  const letters = await db
    .select({ staleItemId: outreach.staleItemId, status: outreach.status, body: outreach.body })
    .from(outreach)
    .where(and(eq(outreach.companyId, companyId), inArray(outreach.staleItemId, candidates.map((c) => c.id))));
  const touched = new Set(letters.filter((l) => l.status !== "draft" || Boolean(l.body?.trim())).map((l) => l.staleItemId));
  const removable = candidates.filter((r) => {
    if (!CLOCK_DRIVEN.has(r.status) || touched.has(r.id)) return false;
    const cls = (r.classification ?? {}) as { remittance?: unknown; resolution?: unknown };
    return !cls.remittance && !cls.resolution;
  });
  if (removable.length === 0) return 0;
  // outreach rows (bare drafts only, checked above) cascade with the item.
  await db.delete(staleItems).where(and(eq(staleItems.companyId, companyId), inArray(staleItems.id, removable.map((r) => r.id))));
  return removable.length;
}

/** Detect the items that are stale at the company's current demo date but not in the pipeline yet. */
export async function detectOnClock(db: Db, companyId: string): Promise<ClockDetection> {
  const s = await detectStaleItems(db, companyId, { onlyNew: true, classify: heuristicBatch, detectedBy: "clock" });
  return { count: s.inserted, cents: s.totalCents, byState: s.byState };
}

/** Move the demo clock by `days` and bring every surface in line with the new date (see the module comment). */
export async function moveDemoClock(db: Db, companyId: string, days: number): Promise<ClockMoveResult> {
  const offsetDays = await clock.advanceClock(db, companyId, days);
  const today = await clock.now(db, companyId);
  const undetected = await pruneFutureDetections(db, companyId, today);
  const detected = await detectOnClock(db, companyId);
  const recompute = await recomputeTimelines(db, companyId);
  if (detected.count > 0 || undetected > 0) {
    console.info(
      `[clock] ${today}: detected ${detected.count} newly stale item(s), ${(detected.cents / 100).toFixed(2)} USD; removed ${undetected} future detection(s)`,
    );
  }
  return { today, offsetDays, detected, undetected, transitions: recompute.transitions, deadlinesMoved: recompute.deadlinesMoved };
}
