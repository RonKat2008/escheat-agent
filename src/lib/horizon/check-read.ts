/**
 * Read model for the "Prediction check" panel on /horizon: the latest forward clock moves and their stored forecast
 * snapshots (demo_clock_events.horizon_check), reconciled with check.ts. Read-only.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { demoClockEvents, staleItems } from "@/db/schema";
import { formatDate } from "@/lib/format";
import { listRuleStates } from "@/lib/rules/load";
import { linkRows, parseSnapshot, reconcilePrediction, type LinkedReconciliation, type PredictionSnapshot } from "./check";

export interface HorizonCheckEntry {
  eventId: string;
  prevDay: string | null;
  day: string;
  /** Counts stored on the event row itself (null on legacy rows). */
  detectedCount: number | null;
  detectedCents: number | null;
  /** null = this move has no stored forecast (it predates the check); never reconstructed. */
  check: LinkedReconciliation | null;
}

export const CHECK_HISTORY_LIMIT = 6;

const itemIdsOf = (s: PredictionSnapshot): string[] => [...s.detected.map((d) => d.itemId), ...s.misses.flatMap((m) => (m.itemId ? [m.itemId] : []))];

/** Newest first: the latest forward move, then up to `limit - 1` earlier ones. */
export async function loadHorizonChecks(db: Db, companyId: string, limit: number = CHECK_HISTORY_LIMIT): Promise<HorizonCheckEntry[]> {
  const rows = await db
    .select({
      id: demoClockEvents.id,
      day: demoClockEvents.demoDay,
      prevDay: demoClockEvents.prevDay,
      detectedCount: demoClockEvents.detectedCount,
      detectedCents: demoClockEvents.detectedCents,
      horizonCheck: demoClockEvents.horizonCheck,
    })
    .from(demoClockEvents)
    .where(and(eq(demoClockEvents.companyId, companyId), eq(demoClockEvents.kind, "move"), eq(demoClockEvents.direction, "forward")))
    .orderBy(desc(demoClockEvents.setAt))
    .limit(limit);
  const snaps = rows.map((r) => parseSnapshot(r.horizonCheck));
  const itemIds = [...new Set(snaps.flatMap((s) => (s ? itemIdsOf(s) : [])))];
  const live = itemIds.length
    ? await db.select({ id: staleItems.id }).from(staleItems).where(and(eq(staleItems.companyId, companyId), inArray(staleItems.id, itemIds)))
    : [];
  const liveIds = new Set(live.map((l) => l.id));
  const ruleStates = listRuleStates();
  return rows.map((r, i) => {
    const snap = snaps[i];
    return {
      eventId: r.id,
      prevDay: r.prevDay,
      day: r.day,
      detectedCount: r.detectedCount,
      detectedCents: r.detectedCents,
      check: snap ? linkRows(reconcilePrediction(snap, ruleStates, formatDate), liveIds) : null,
    };
  });
}
