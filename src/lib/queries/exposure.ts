import { cache } from "react";
import { and, eq, notInArray, sql, sum, count } from "drizzle-orm";
import type { Db } from "@/db/client";
import { staleItems } from "@/db/schema";
import { formatUSD } from "@/lib/money";
import { NOT_COVERED_COPY, splitByCoverage } from "@/lib/coverage";
import { inScopeStates } from "@/lib/coverage-server";
import { FILED_STATUSES, openStatusCondition, today } from "./common";
import type { Exposure } from "./schemas";

export interface ExposureOptions {
  state?: string;
  includeFiled?: boolean;
}

/**
 * Company-wide exposure (no options), once per server render: the dashboard hero and its interest section both ask for
 * it in the same request. Same per-render scope as loadOpenRows (a plain call outside a render); read-only result.
 */
const exposureAll = cache((db: Db, companyId: string): Promise<Exposure> => computeExposure(db, companyId, {}));

/** Exposure = open, unfiled stale items: everything except resolved_paid, remitted and reported (already filed with the state). */
export function getExposure(db: Db, companyId: string, opts: ExposureOptions = {}): Promise<Exposure> {
  const scoped = Boolean(opts.state?.trim()) || opts.includeFiled === true;
  return scoped ? computeExposure(db, companyId, opts) : exposureAll(db, companyId);
}

async function computeExposure(db: Db, companyId: string, opts: ExposureOptions): Promise<Exposure> {
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
  const ruleStates = inScopeStates();
  const split = splitByCoverage(states, ruleStates);
  const coverage = {
    inScopeStates: ruleStates,
    inScope: {
      count: split.inScopeCount,
      cents: split.inScopeCents,
      formatted: formatUSD(split.inScopeCents),
      states: split.inScope.map((s) => s.state),
    },
    notCovered: {
      ...split.summary,
      byState: split.notCovered.map((s) => ({ state: s.state, count: s.count, cents: s.cents, formatted: s.formatted })),
      note: NOT_COVERED_COPY,
    },
  };
  return {
    asOf,
    totalCents,
    total: { cents: totalCents, formatted: formatUSD(totalCents) },
    itemCount: states.reduce((a, s) => a + s.count, 0),
    anyUnverified: states.some((s) => s.anyUnverified),
    byState: states,
    coverage,
    byStatus: byStatus
      .map((r) => ({ status: r.status, cents: c(r.cents), formatted: formatUSD(c(r.cents)), count: Number(r.n) }))
      .sort((a, b) => b.cents - a.cents),
    byPropertyType: byType
      .map((r) => ({ propertyType: r.propertyType, cents: c(r.cents), formatted: formatUSD(c(r.cents)), count: Number(r.n) }))
      .sort((a, b) => b.cents - a.cents),
  };
}
