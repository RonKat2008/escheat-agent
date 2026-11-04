/**
 * Read model for the Pre-stale Horizon: outstanding payments that are NOT yet business-stale, with projected legal dates.
 * Strictly read-only: reconciliation runs with persist:false (no writes) and nothing else touches the DB.
 * Items that already have a stale_items row are excluded (they live in the pipeline already).
 */
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { companies, payees, staleItems, type PropertyType } from "@/db/schema";
import { diffDays, type IsoDate } from "@/lib/dates";
import { staleThresholdDays } from "@/lib/env";
import { bucketByDaysUntilStale, type StaleBucket } from "@/lib/horizon/buckets";
import { projectItem, sortWorklist, type HorizonItem } from "@/lib/horizon/project";
import { runReconciliation } from "@/lib/ingest/persist";
import { computeItemTimeline } from "@/lib/pipeline/compute";
import { listRuleStates } from "@/lib/rules/load";
import { today } from "./common";

/** A presumed-abandoned ring: days from issue, for one or more (state, property type) pairs, straight from the engine. */
export interface DormancyRing {
  days: number;
  /** e.g. ["CA vendor check", "TX vendor check"] */
  members: { state: string; propertyType: PropertyType }[];
  unverified: boolean;
}

export interface HorizonData {
  asOf: string;
  thresholdDays: number;
  items: HorizonItem[];
  totalCents: number;
  buckets: StaleBucket[];
  rings: DormancyRing[];
  /** Outstanding, past the threshold, but not yet picked up by a detection run (not on the radar; honest count). */
  awaitingDetection: { count: number; cents: number };
}

/** Engine presumed-abandoned offsets (days from issue) per supported state, for the property types on the radar. */
export function dormancyRings(asOf: IsoDate, propertyTypes: readonly PropertyType[], holderFiscalYearEnd: string): DormancyRing[] {
  const types: PropertyType[] = propertyTypes.length > 0 ? [...new Set(propertyTypes)] : ["vendor_check"];
  const byDays = new Map<number, DormancyRing>();
  for (const state of listRuleStates()) {
    for (const propertyType of types) {
      const tl = computeItemTimeline({ ownerState: state, propertyType, lastActivityDate: asOf, amountCents: 10_000, holderFiscalYearEnd });
      const date = tl.dates.presumedAbandonedDate;
      if (!date) continue;
      const days = diffDays(asOf, date as IsoDate);
      const ring = byDays.get(days) ?? { days, members: [], unverified: false };
      byDays.set(days, { ...ring, members: [...ring.members, { state, propertyType }], unverified: ring.unverified || tl.dates.dependsOnUnverified });
    }
  }
  return [...byDays.values()].sort((a, b) => a.days - b.days);
}

export async function getHorizon(db: Db, companyId: string): Promise<HorizonData> {
  const [company] = await db.select({ fiscalYearEnd: companies.fiscalYearEnd }).from(companies).where(eq(companies.id, companyId));
  if (!company) throw new Error(`Unknown company ${companyId}`);
  const asOf = await today(db, companyId);
  const thresholdDays = staleThresholdDays();

  const [recon, staleRows, payeeRows] = await Promise.all([
    runReconciliation(db, companyId, asOf, { persist: false }),
    db.select({ ledgerItemId: staleItems.ledgerItemId }).from(staleItems).where(eq(staleItems.companyId, companyId)),
    db.select({ id: payees.id, name: payees.canonicalName }).from(payees).where(eq(payees.companyId, companyId)),
  ]);
  const inPipeline = new Set(staleRows.map((r) => r.ledgerItemId));
  const payeeName = new Map(payeeRows.map((p) => [p.id, p.name]));

  const candidates = recon.outstanding.filter((o) => !inPipeline.has(o.id) && o.ageDays >= 0);
  const preStale = candidates.filter((o) => o.ageDays <= thresholdDays);
  const crossed = candidates.filter((o) => o.ageDays > thresholdDays);

  const items = sortWorklist(
    preStale.map((o) =>
      projectItem(
        {
          ledgerItemId: o.id,
          checkNumber: o.referenceNumber,
          payeeName: (o.payeeId ? payeeName.get(o.payeeId) : null) ?? o.payeeNameRaw,
          propertyType: o.propertyType,
          amountCents: o.amountCents,
          issueDate: o.issueDate,
          lastActivityDate: o.lastActivityDate,
          addressState: o.state,
          ageDays: o.ageDays,
        },
        { thresholdDays, holderFiscalYearEnd: company.fiscalYearEnd },
      ),
    ),
  );

  return {
    asOf,
    thresholdDays,
    items,
    totalCents: items.reduce((s, i) => s + i.amountCents, 0),
    buckets: bucketByDaysUntilStale(items),
    rings: dormancyRings(asOf, items.map((i) => i.propertyType), company.fiscalYearEnd),
    awaitingDetection: { count: crossed.length, cents: crossed.reduce((s, o) => s + o.amountCents, 0) },
  };
}
