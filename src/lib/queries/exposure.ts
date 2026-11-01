import { and, eq, notInArray, sql, sum, count } from "drizzle-orm";
import type { Db } from "@/db/client";
import { staleItems } from "@/db/schema";
import { formatUSD } from "@/lib/money";
import { FILED_STATUSES, openStatusCondition, today } from "./common";
import type { Exposure } from "./schemas";

/** Exposure = open, unfiled stale items: everything except resolved_paid, remitted and reported (already filed with the state). */
export async function getExposure(db: Db, companyId: string, opts: { state?: string; includeFiled?: boolean } = {}): Promise<Exposure> {
  const asOf = await today(db, companyId);
  const state = opts.state?.trim().toUpperCase();
  const where = and(
    eq(staleItems.companyId, companyId),
    openStatusCondition(),
    opts.includeFiled ? undefined : notInArray(staleItems.status, [...FILED_STATUSES]),
    state ? eq(staleItems.ownerState, state) : undefined,
  );
  const stateExpr = sql<string>`coalesce(${staleItems.ownerState}, 'UNKNOWN')`;
  const [byState, byStatus, byType] = await Promise.all([
    db
      .select({
        state: stateExpr,
        cents: sum(staleItems.amountCents),
        n: count(),
        unverified: sql<number>`count(*) filter (where ${staleItems.dependsOnUnverified} or ${staleItems.status} = 'needs_rule')`,
      })
      .from(staleItems)
      .where(where)
      .groupBy(stateExpr),
    db.select({ status: staleItems.status, cents: sum(staleItems.amountCents), n: count() }).from(staleItems).where(where).groupBy(staleItems.status),
    db
      .select({ propertyType: staleItems.propertyType, cents: sum(staleItems.amountCents), n: count() })
      .from(staleItems)
      .where(where)
      .groupBy(staleItems.propertyType),
  ]);
  const c = (v: string | null) => Number(v ?? 0);
  const states = byState
    .map((r) => ({ state: r.state, cents: c(r.cents), formatted: formatUSD(c(r.cents)), count: Number(r.n), anyUnverified: Number(r.unverified) > 0 }))
    .sort((a, b) => b.cents - a.cents || a.state.localeCompare(b.state));
  const totalCents = states.reduce((a, s) => a + s.cents, 0);
  return {
    asOf,
    totalCents,
    total: { cents: totalCents, formatted: formatUSD(totalCents) },
    itemCount: states.reduce((a, s) => a + s.count, 0),
    anyUnverified: states.some((s) => s.anyUnverified),
    byState: states,
    byStatus: byStatus
      .map((r) => ({ status: r.status, cents: c(r.cents), formatted: formatUSD(c(r.cents)), count: Number(r.n) }))
      .sort((a, b) => b.cents - a.cents),
    byPropertyType: byType
      .map((r) => ({ propertyType: r.propertyType, cents: c(r.cents), formatted: formatUSD(c(r.cents)), count: Number(r.n) }))
      .sort((a, b) => b.cents - a.cents),
  };
}
