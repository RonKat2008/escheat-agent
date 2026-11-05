/**
 * CFO brief read model: every figure on the one-page brief comes from the SAME deterministic query the dashboard,
 * ledger, forecast, approvals and recoveries pages use. Nothing here computes a legal value or estimates a number;
 * a missing interest rule stays "unknown" and unverified rule files are named as such. Read only.
 */
import type { Db } from "@/db/client";
import { waitingBreakdown, type WaitingBreakdown } from "@/app/(app)/approvals/queue-count";
import { computeLedger, loadLedger } from "@/lib/queries/ledger";
import { getCompany, getExposure, getForecast, getOpenCounts, getOverdue, upcomingDeadlines } from "@/lib/queries";
import { FILED_STATUSES } from "@/lib/queries/common";
import { loadOpenRows } from "@/lib/queries/items";
import { listRecoveries } from "@/lib/recoveries/service";
import { CATCH_UP_STATES, summarizeLateMoney, type LateMoneySummary } from "@/lib/reports/late-money";
import { tryLoadRules } from "@/lib/rules/load";
import type { NotCoveredSummary } from "@/lib/coverage";
import { allVerified, listRuleValues } from "@/lib/rules/values";

/** States the brief tables, in this order (the states the prototype has rule files and reports for). */
export const BRIEF_STATES: readonly string[] = CATCH_UP_STATES;
/** How far ahead "next deadline" looks (the engine's dates; the brief never invents one past this). */
export const NEXT_DEADLINE_WINDOW_DAYS = 3650; // 10 years: "next" is the earliest engine date, however far out
/** Forecast months drawn as bars. */
export const FORECAST_MONTHS = 6;

export interface BriefStateRow {
  state: string;
  count: number;
  cents: number;
  nextDeadline: { date: string; kind: string; daysLeft: number } | null;
  ruleVersion: string | null;
  /** Unfiled open items in the state whose report due date the engine could not compute (never guessed). */
  datesUnknown: number;
  /** True when the state's rule file has any unverified value (or there is no rule file). */
  unverified: boolean;
}

export interface CfoBriefData {
  company: string;
  asOf: string;
  generatedAt: string;
  headline: {
    cents: number;
    count: number;
    /** Every state in the total (money is real liability wherever it sits). */
    states: string[];
    /** States with a rules file: the ones the app files in. */
    inScopeStates: string[];
    /** Open items in states with no rules file: in the total, with no dates (R9-03). */
    notCovered: NotCoveredSummary;
    reportedCount: number; reportedCents: number;
    anyUnverified: boolean;
  };
  states: BriefStateRow[];
  overdue: { count: number; cents: number; verified: boolean; unknownCount: number };
  late: Pick<LateMoneySummary, "lateCount" | "lateCents" | "interestCents" | "interestVerified" | "interestStates" | "unknownInterestStates">;
  waiting: WaitingBreakdown;
  recoveries: { foundCount: number; foundCents: number; paidCount: number; paidCents: number };
  ledger: { periodStart: string; periodEnd: string; closingCents: number; reconciles: boolean };
  forecast: { months: { month: string; cents: number; unverified: boolean }[]; totalCents: number; basis: "presumed" };
  ruleVersions: { state: string; version: string; unverified: boolean }[];
}

function ruleInfo(state: string): { version: string | null; unverified: boolean } {
  const loaded = tryLoadRules(state);
  if (!loaded) return { version: null, unverified: true };
  return { version: loaded.file.version, unverified: !allVerified(listRuleValues(loaded.file)) };
}

/** Everything the brief prints, read once. `generatedAt` is passed in so tests and the route agree on the stamp. */
export async function loadCfoBrief(db: Db, companyId: string, opts: { generatedAt: Date }): Promise<CfoBriefData> {
  const [company, exposure, openCounts, overdue, deadlines, waiting, recoveries, ledgerData, forecast, openRows] = await Promise.all([
    getCompany(db, companyId),
    getExposure(db, companyId),
    getOpenCounts(db, companyId),
    getOverdue(db, companyId),
    upcomingDeadlines(db, companyId, NEXT_DEADLINE_WINDOW_DAYS),
    waitingBreakdown(db, companyId),
    listRecoveries(db, companyId),
    loadLedger(db, companyId),
    getForecast(db, companyId, { horizonMonths: FORECAST_MONTHS }),
    loadOpenRows(db, companyId),
  ]);
  // Same call as the dashboard (src/app/(app)/dashboard/data.ts), so the late money and interest match it exactly.
  const late = summarizeLateMoney(overdue.items, (s) => tryLoadRules(s)?.file ?? null, overdue.asOf);
  const ledger = computeLedger(ledgerData, "fy");

  const states: BriefStateRow[] = BRIEF_STATES.map((state) => {
    const exp = exposure.byState.find((s) => s.state === state);
    const next = deadlines.events.find((e) => e.state === state);
    const rule = ruleInfo(state);
    return {
      state,
      count: exp?.count ?? 0,
      cents: exp?.cents ?? 0,
      nextDeadline: next ? { date: next.date, kind: next.kind, daysLeft: next.daysUntil } : null,
      ruleVersion: rule.version,
      datesUnknown: openRows.filter((r) => r.ownerState === state && !(FILED_STATUSES as readonly string[]).includes(r.status) && !r.reportDueDate).length,
      unverified: rule.unverified,
    };
  });

  const found = recoveries.filter((r) => r.status !== "rejected");
  const paid = recoveries.filter((r) => r.status === "paid");
  const months = forecast.months.map((m) => ({
    month: m.month,
    cents: m.presumedCents,
    unverified: m.byState.some((c) => c.unverified && c.presumedCount > 0),
  }));

  return {
    company: company.name,
    asOf: exposure.asOf,
    generatedAt: opts.generatedAt.toISOString(),
    headline: {
      cents: exposure.totalCents,
      count: openCounts.unreported.count,
      states: exposure.byState.map((s) => s.state),
      inScopeStates: exposure.coverage.inScope.states,
      notCovered: {
        states: exposure.coverage.notCovered.states,
        count: exposure.coverage.notCovered.count,
        cents: exposure.coverage.notCovered.cents,
        formatted: exposure.coverage.notCovered.formatted,
        hasUnknownState: exposure.coverage.notCovered.hasUnknownState,
      },
      reportedCount: openCounts.reported.count,
      reportedCents: openCounts.reported.cents,
      anyUnverified: exposure.anyUnverified,
    },
    states,
    overdue: { count: overdue.count, cents: overdue.total.cents, verified: overdue.verified, unknownCount: overdue.unknownCount },
    late: {
      lateCount: late.lateCount,
      lateCents: late.lateCents,
      interestCents: late.interestCents,
      interestVerified: late.interestVerified,
      interestStates: late.interestStates,
      unknownInterestStates: late.unknownInterestStates,
    },
    waiting,
    recoveries: {
      foundCount: found.length,
      foundCents: found.reduce((a, r) => a + r.amountCents, 0),
      paidCount: paid.length,
      paidCents: paid.reduce((a, r) => a + r.amountCents, 0),
    },
    ledger: { periodStart: ledger.roll.period.start, periodEnd: ledger.roll.period.end, closingCents: ledger.roll.total.closing, reconciles: ledger.roll.total.reconciles },
    forecast: { months, totalCents: months.reduce((a, m) => a + m.cents, 0), basis: "presumed" },
    ruleVersions: states.filter((s) => s.ruleVersion !== null).map((s) => ({ state: s.state, version: s.ruleVersion!, unverified: s.unverified })),
  };
}
