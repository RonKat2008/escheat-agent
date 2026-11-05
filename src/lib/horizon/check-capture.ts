/**
 * Capture the "Horizon said so" snapshot inside moveDemoClock's transaction (server only).
 *
 *   1. forecastStaleBy(): BEFORE the clock moves, run the same Horizon read model the page renders (getHorizon) as of the
 *      current demo day and keep the payments whose stale day falls on or before the target day.
 *   2. captureHorizonCheck(): AFTER detection, record which payments the move detected and, for each predicted payment
 *      that was not detected, what was true right then (cleared at the bank and when, voided, ambiguous, in the pipeline
 *      already). Nothing is inferred later; a difference without a known reason is stored as "unknown".
 */
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { bankClears, ledgerItems, payees, staleItems } from "@/db/schema";
import { addDays, type IsoDate } from "@/lib/dates";
import { runReconciliation } from "@/lib/ingest/persist";
import { getHorizon } from "@/lib/queries/horizon";
import type { CheckRow, DetectedRow, MissReason, PredictionSnapshot } from "./check";

export interface HorizonForecast {
  asOf: string;
  by: string;
  thresholdDays: number;
  predicted: CheckRow[];
}

/** Horizon's prediction, made now (before the move), of what goes stale within `days`. */
export async function forecastStaleBy(db: Db, companyId: string, days: number): Promise<HorizonForecast> {
  const h = await getHorizon(db, companyId);
  const by = addDays(h.asOf as IsoDate, days);
  // daysUntilStale is measured with detection's own rule (age > threshold), so "<= days" means stale on or before `by`.
  const predicted = h.items
    .filter((i) => i.daysUntilStale <= days)
    .map((i) => ({ id: i.ledgerItemId, cents: i.amountCents, check: i.checkNumber, payee: i.payeeName, state: i.ownerState }));
  return { asOf: h.asOf, by, thresholdDays: h.thresholdDays, predicted };
}

async function detectedRows(db: Db, companyId: string, itemIds: readonly string[]): Promise<DetectedRow[]> {
  if (itemIds.length === 0) return [];
  const rows = await db
    .select({
      itemId: staleItems.id,
      id: staleItems.ledgerItemId,
      cents: staleItems.amountCents,
      state: staleItems.ownerState,
      staleOn: staleItems.staleSince,
      check: ledgerItems.referenceNumber,
      payeeRaw: ledgerItems.payeeNameRaw,
      payee: payees.canonicalName,
    })
    .from(staleItems)
    .innerJoin(ledgerItems, eq(ledgerItems.id, staleItems.ledgerItemId))
    .leftJoin(payees, eq(payees.id, ledgerItems.payeeId))
    .where(and(eq(staleItems.companyId, companyId), inArray(staleItems.id, [...itemIds])));
  return rows
    .map((r) => ({ id: r.id, itemId: r.itemId, cents: r.cents, state: r.state, staleOn: r.staleOn, check: r.check, payee: r.payee ?? r.payeeRaw }))
    .sort((a, b) => a.staleOn.localeCompare(b.staleOn) || b.cents - a.cents || a.id.localeCompare(b.id));
}

async function missFacts(db: Db, companyId: string, by: string, ids: readonly string[]): Promise<PredictionSnapshot["misses"]> {
  if (ids.length === 0) return [];
  const [ledger, clears, inPipeline] = await Promise.all([
    db.select({ id: ledgerItems.id, status: ledgerItems.status }).from(ledgerItems).where(inArray(ledgerItems.id, [...ids])),
    db.select({ id: bankClears.ledgerItemId, on: bankClears.clearedDate }).from(bankClears).where(and(eq(bankClears.companyId, companyId), inArray(bankClears.ledgerItemId, [...ids]))),
    db.select({ id: staleItems.ledgerItemId, itemId: staleItems.id }).from(staleItems).where(and(eq(staleItems.companyId, companyId), inArray(staleItems.ledgerItemId, [...ids]))),
  ]);
  const status = new Map(ledger.map((l) => [l.id, l.status]));
  const clearedOn = new Map(clears.map((c) => [c.id, c.on]));
  const item = new Map(inPipeline.map((p) => [p.id, p.itemId]));
  const needRecon = ids.some((id) => !item.has(id) && status.get(id) === "outstanding");
  const recon = needRecon ? await runReconciliation(db, companyId, by, { persist: false }) : null;
  const ambiguous = new Set(recon?.result.ambiguous.map((a) => a.ledgerId) ?? []);
  const stillOutstanding = new Set(recon?.outstanding.map((o) => o.id) ?? []);

  return ids.map((id) => {
    const itemId = item.get(id) ?? null;
    let why: MissReason = "unknown";
    if (itemId) why = "in_pipeline";
    else if (status.get(id) === "cleared") why = "cleared";
    else if (status.get(id) === "voided") why = "voided";
    else if (ambiguous.has(id)) why = "ambiguous";
    else if (stillOutstanding.has(id)) why = "not_stale";
    return { id, why, on: why === "cleared" ? (clearedOn.get(id) ?? null) : null, itemId };
  });
}

/** Build the stored snapshot from the forecast and the stale_items ids the move inserted. */
export async function captureHorizonCheck(db: Db, companyId: string, forecast: HorizonForecast, newItemIds: readonly string[]): Promise<PredictionSnapshot> {
  const detected = await detectedRows(db, companyId, newItemIds);
  const detectedIds = new Set(detected.map((d) => d.id));
  const missedIds = forecast.predicted.filter((p) => !detectedIds.has(p.id)).map((p) => p.id);
  return {
    v: 1,
    asOf: forecast.asOf,
    by: forecast.by,
    thresholdDays: forecast.thresholdDays,
    predicted: forecast.predicted,
    detected,
    misses: await missFacts(db, companyId, forecast.by, missedIds),
  };
}
