/**
 * R8 Escheat Ledger loader: every stale item (any status) with what dating its movements needs, the clock history,
 * the demo-clock date, the company's fiscal year end and, per filed report, the replica confirmation and the
 * unverified-rule count frozen at approval. Read only.
 */
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { companies, ledgerItems, payees, periodCloses, reports, staleItems } from "@/db/schema";
import { loadClockHistory, type ClockStep } from "@/lib/clock-history";
import { now as clockNow } from "@/lib/clock";
import { applyCloses, withFrozenEntries, type ClosedPeriod, type Coverage } from "@/lib/ledger/closes";
import { buildJournal, type Journal, type JournalEntry, type ReportRef } from "@/lib/ledger/journal";
import { allMovements, type LedgerItem, type Movement } from "@/lib/ledger/movements";
import { balanceAsOf, earliestDate, itemsBehind, periodFor, rollForward, type BarId, type Period, type PeriodId, type RollForward } from "@/lib/ledger/rollforward";
import { splitByCoverage, type NotCoveredSummary } from "@/lib/coverage";
import { inScopeStates } from "@/lib/coverage-server";
import { parseFilingRecord } from "@/lib/reports/filing-record";

export interface LedgerData {
  today: string;
  fiscalYearEnd: string;
  history: ClockStep[];
  items: LedgerItem[];
  reports: Map<string, ReportRef>;
  /** Months closed by closePeriod (R10-01): their frozen entries, and what posts to the next open month. */
  closes?: ClosedPeriod[];
}

/** The coverage a close stored in its snapshot (R11-01), or null for a close recorded before migration 0016. */
function coverageFromSnapshot(snapshot: unknown): Coverage | null {
  const covered = (snapshot as { covered?: unknown } | null)?.covered;
  return covered && typeof covered === "object" && !Array.isArray(covered) ? (covered as Coverage) : null;
}

/** Every movement with the closed months applied: late detections in a closed month move to the next open month. */
export function ledgerMovements(data: LedgerData): Movement[] {
  return applyCloses(allMovements(data.items, data.history, data.today), data.closes ?? []);
}

export async function loadLedger(db: Db, companyId: string): Promise<LedgerData> {
  const lateClear = sql<string | null>`(
    select min(bc.cleared_date)::text from bank_clears bc
    where bc.ledger_item_id = ${staleItems.ledgerItemId} and bc.cleared_date >= ${staleItems.staleSince}
  )`;
  const [today, history, company, rows, filed, closed] = await Promise.all([
    clockNow(db, companyId),
    loadClockHistory(db, companyId),
    db.select({ fye: companies.fiscalYearEnd }).from(companies).where(eq(companies.id, companyId)),
    db
      .select({
        id: staleItems.id,
        state: staleItems.ownerState,
        propertyType: staleItems.propertyType,
        amountCents: staleItems.amountCents,
        status: staleItems.status,
        staleSince: staleItems.staleSince,
        resolvedAt: staleItems.resolvedAt,
        classification: staleItems.classification,
        dependsOnUnverified: staleItems.dependsOnUnverified,
        payeeName: payees.canonicalName,
        payeeRaw: ledgerItems.payeeNameRaw,
        checkNumber: ledgerItems.referenceNumber,
        lateClearDate: lateClear,
      })
      .from(staleItems)
      .innerJoin(ledgerItems, eq(ledgerItems.id, staleItems.ledgerItemId))
      .leftJoin(payees, eq(payees.id, staleItems.ownerPayeeId))
      .where(eq(staleItems.companyId, companyId)),
    db
      .select({ id: reports.id, confirmation: reports.replicaConfirmation, filingRecord: reports.filingRecord })
      .from(reports)
      .where(and(eq(reports.companyId, companyId), sql`(${reports.submittedAt} is not null or ${reports.replicaConfirmation} is not null)`)),
    db.select({ period: periodCloses.period, journal: periodCloses.journal, snapshot: periodCloses.snapshot }).from(periodCloses).where(eq(periodCloses.companyId, companyId)),
  ]);
  return {
    today,
    fiscalYearEnd: company[0]?.fye ?? "12-31",
    history,
    items: rows.map((r) => ({
      id: r.id,
      state: r.state,
      propertyType: r.propertyType,
      amountCents: r.amountCents,
      status: r.status,
      staleSince: r.staleSince,
      resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
      classification: r.classification,
      lateClearDate: r.lateClearDate ? r.lateClearDate.slice(0, 10) : null,
      payee: r.payeeName ?? r.payeeRaw,
      checkNumber: r.checkNumber,
      dependsOnUnverified: r.dependsOnUnverified,
    })),
    closes: closed.map((c) => ({ period: c.period, entries: c.journal as JournalEntry[], covered: coverageFromSnapshot(c.snapshot) })),
    reports: new Map(filed.map((r) => [r.id, { confirmation: r.confirmation, unverifiedRuleCount: parseFilingRecord(r.filingRecord)?.unverifiedRuleCount ?? 0 }])),
  };
}

export interface LedgerView {
  today: string;
  roll: RollForward;
  journal: Journal;
  behind: Record<BarId, Movement[]>;
  /** States with a rules file; every other state column is "rules not loaded" (R9-03). Their payable is still real. */
  ruleStates: string[];
  /** Open items at the period end in states with no rules file, by closing balance (ties to the roll-forward). */
  notCovered: NotCoveredSummary;
}

/** The period's roll-forward and journal (shared by /ledger and GET /api/ledger.csv so they always agree). */
export function computeLedger(data: LedgerData, periodId: PeriodId, override?: Period): LedgerView {
  const movements = ledgerMovements(data);
  const period = override ?? periodFor(periodId, data.today, data.fiscalYearEnd, earliestDate(movements));
  const roll = rollForward(movements, period);
  const ruleStates = inScopeStates();
  const rows = roll.states.map((s) => {
    const ofState = movements.filter((m) => m.state === s.state);
    const ids = [...new Set(ofState.map((m) => m.itemId))];
    const open = ids.filter((id) => balanceAsOf(ofState.filter((m) => m.itemId === id), period.end) > 0).length;
    return { state: s.state, cents: s.closing, count: open };
  });
  const notCovered = splitByCoverage(rows, ruleStates).summary;
  return { today: data.today, roll, journal: withFrozenEntries(buildJournal(roll.movements, data.reports), data.closes ?? [], period.start, period.end), behind: itemsBehind(movements, period), ruleStates, notCovered };
}
