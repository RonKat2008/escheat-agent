import { cache } from "react";
import { and, count, eq, inArray } from "drizzle-orm";
import { outreach, reports } from "@/db/schema";
import { isFirstVisit } from "@/components/motion/first-visit";
import { compactUSD } from "@/components/viz/core/money-label";
import { loadLoopData } from "@/components/shell/loop-data";
import type { MapStateDatum } from "@/components/viz/money-map/types";
import { formatUSD } from "@/lib/money";
import { getCompany, getExposure, getOpenCounts, getOverdue, listStaleItems } from "@/lib/queries";
import { getMoneyFlow, lateRows } from "@/lib/queries/flow";
import { loadOpenRows } from "@/lib/queries/items";
import { summarizeLateMoney } from "@/lib/reports/late-money";
import { tryLoadRules } from "@/lib/rules/load";
import { getCtx } from "@/lib/ui/ctx";
import { countOwnerTasks } from "@/app/(app)/approvals/queue-count";

const TOP_ITEMS = 3;
/** Statuses getExposure leaves out (closed or already filed), so the map's top items match its totals. */
const NOT_EXPOSED = new Set(["resolved_paid", "remitted", "reported"]);

/**
 * Everything the dashboard hero, Money Map and Sankey read, fetched once per request (React cache) inside the page's
 * single Suspense boundary. Every figure is a query result; the map columns and Sankey "At risk" nodes are the same
 * getMoneyFlow rows, which reconcile to getExposure (unit tested in src/lib/queries/flow.test.ts).
 */
export const loadDashboard = cache(async () => {
  const { db, companyId } = await getCtx();
  // The Money Flow's Late band and its interest come from the same overdue assessment and engine call as the Overdue
  // panel, so the two never disagree (R4-07).
  const overdueP = getOverdue(db, companyId);
  const lateP = overdueP.then((o) => ({ o, late: summarizeLateMoney(o.items, (state) => tryLoadRules(state)?.file ?? null, o.asOf) }));
  const flowP = lateP.then(({ o, late }) =>
    getMoneyFlow(db, companyId, {
      late: lateRows(o.items),
      lateInterest: { cents: late.interestCents, verified: late.interestVerified, unknownStates: late.unknownInterestStates },
    }),
  );
  const [first, exposure, { o: overdue, late: lateMoney }, flow, company, openRows, review, drafts, ready, loop, openCounts, ownerTasks] = await Promise.all([
    isFirstVisit("dashboard"),
    getExposure(db, companyId),
    lateP,
    flowP,
    getCompany(db, companyId),
    loadOpenRows(db, companyId),
    listStaleItems(db, companyId, { needsReview: true, limit: 1 }),
    db
      .select({ n: count() })
      .from(outreach)
      .where(and(eq(outreach.companyId, companyId), inArray(outreach.status, ["draft", "awaiting_approval"]))),
    db
      .select({ n: count() })
      .from(reports)
      .where(and(eq(reports.companyId, companyId), inArray(reports.status, ["validated", "awaiting_approval", "approved"]))),
    loadLoopData(),
    getOpenCounts(db, companyId),
    countOwnerTasks(db, companyId),
  ]);

  const top = new Map<string, MapStateDatum["top"]>();
  for (const r of [...openRows].filter((x) => !NOT_EXPOSED.has(x.status)).sort((a, b) => b.amountCents - a.amountCents)) {
    const key = r.ownerState ?? "UNKNOWN";
    const list = top.get(key) ?? [];
    if (list.length < TOP_ITEMS) {
      top.set(key, [...list, { id: r.id, payee: r.payeeName ?? r.payeeNameRaw, check: r.checkNumber, formatted: formatUSD(r.amountCents) }]);
    }
  }
  const mapStates = flow.byState.map((s) => ({
    state: s.state,
    cents: s.cents,
    short: compactUSD(s.cents),
    formatted: formatUSD(s.cents),
    count: s.count,
    urgent: s.urgent,
    late: s.late,
    unverified: s.unverified > 0,
    href: `/items?state=${s.state}`,
    top: top.get(s.state) ?? [],
  }));

  return {
    first,
    exposure,
    /** R4-05: the shared open-item definition (same as Items); the hero labels reported-awaiting-remittance with it. */
    openCounts,
    overdue,
    lateMoney,
    flow,
    company,
    mapStates,
    loop,
    counts: { review: review.total, drafts: drafts[0]?.n ?? 0, ready: ready[0]?.n ?? 0, ownerTasks: ownerTasks.count, ownerTasksCents: ownerTasks.cents },
  };
});

export type DashboardData = Awaited<ReturnType<typeof loadDashboard>>;
