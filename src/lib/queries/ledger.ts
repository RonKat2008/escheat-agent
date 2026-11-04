/**
 * R8 Escheat Ledger loader: every stale item (any status) with what dating its movements needs, the clock history,
 * the demo-clock date, the company's fiscal year end and, per filed report, the replica confirmation and the
 * unverified-rule count frozen at approval. Read only.
 */
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { companies, ledgerItems, payees, reports, staleItems } from "@/db/schema";
import { loadClockHistory, type ClockStep } from "@/lib/clock-history";
import { now as clockNow } from "@/lib/clock";
import { buildJournal, type Journal, type ReportRef } from "@/lib/ledger/journal";
import { allMovements, type LedgerItem, type Movement } from "@/lib/ledger/movements";
import { earliestDate, itemsBehind, periodFor, rollForward, type BarId, type PeriodId, type RollForward } from "@/lib/ledger/rollforward";
import { parseFilingRecord } from "@/lib/reports/filing-record";

export interface LedgerData {
  today: string;
  fiscalYearEnd: string;
  history: ClockStep[];
  items: LedgerItem[];
  reports: Map<string, ReportRef>;
}

export async function loadLedger(db: Db, companyId: string): Promise<LedgerData> {
  const lateClear = sql<string | null>`(
    select min(bc.cleared_date)::text from bank_clears bc
    where bc.ledger_item_id = ${staleItems.ledgerItemId} and bc.cleared_date >= ${staleItems.staleSince}
  )`;
  const [today, history, company, rows, filed] = await Promise.all([
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
    reports: new Map(filed.map((r) => [r.id, { confirmation: r.confirmation, unverifiedRuleCount: parseFilingRecord(r.filingRecord)?.unverifiedRuleCount ?? 0 }])),
  };
}

export interface LedgerView {
  today: string;
  roll: RollForward;
  journal: Journal;
  behind: Record<BarId, Movement[]>;
}

/** The period's roll-forward and journal (shared by /ledger and GET /api/ledger.csv so they always agree). */
export function computeLedger(data: LedgerData, periodId: PeriodId): LedgerView {
  const movements = allMovements(data.items, data.history, data.today);
  const period = periodFor(periodId, data.today, data.fiscalYearEnd, earliestDate(movements));
  const roll = rollForward(movements, period);
  return { today: data.today, roll, journal: buildJournal(roll.movements, data.reports), behind: itemsBehind(movements, period) };
}
