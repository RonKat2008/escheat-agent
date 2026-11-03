import { and, count, eq, sum } from "drizzle-orm";
import type { Db } from "@/db/client";
import { staleItems } from "@/db/schema";
import { FILED_STATUSES, openStatusCondition, today } from "./common";

interface Bucket {
  count: number;
  cents: number;
}

export interface OpenCounts {
  asOf: string;
  /** Open = not remitted and not resolved (the Items "All open items" total and the state ribbon). */
  open: Bucket;
  /** Open and not yet reported: what getExposure() totals ("Outstanding, not yet filed"). */
  unreported: Bucket;
  /** Reported to the state but not yet remitted: open, but no longer a filing obligation. */
  reported: Bucket;
}

/**
 * R4-05: the one definition of "how many stale items are open". Built from the same open-status condition Items
 * uses, split into unreported (what exposure shows) and reported-awaiting-remittance, so every page shows the same
 * numbers or labels the difference ("46 not yet reported · 1 reported, remittance due").
 */
export async function getOpenCounts(db: Db, companyId: string): Promise<OpenCounts> {
  const asOf = await today(db, companyId);
  const rows = await db
    .select({ status: staleItems.status, n: count(), cents: sum(staleItems.amountCents) })
    .from(staleItems)
    .where(and(eq(staleItems.companyId, companyId), openStatusCondition()))
    .groupBy(staleItems.status);
  const filed = new Set<string>(FILED_STATUSES);
  const unreported: Bucket = { count: 0, cents: 0 };
  const reported: Bucket = { count: 0, cents: 0 };
  for (const r of rows) {
    const b = filed.has(r.status) ? reported : unreported;
    b.count += Number(r.n);
    b.cents += Number(r.cents ?? 0);
  }
  return {
    asOf,
    open: { count: unreported.count + reported.count, cents: unreported.cents + reported.cents },
    unreported,
    reported,
  };
}
