/**
 * The Filing section of the evidence pack (R5-12). R6-01: printed from the report's frozen filing record (written at
 * approval), never from the live items, so recording the remittance cannot rewrite it; the remittance itself is
 * added from the items it moved. A report filed before records existed falls back to the receipt's live figures and
 * says so. Read-only. Returns null until the report is submitted, so a pack made before filing says "not filed yet".
 */
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { approvals, type Report } from "@/db/schema";
import { approverName } from "@/lib/auth/approver";
import { loadRemittance } from "@/lib/close-out/remittance";
import { buildRunner } from "@/lib/close-out/runner";
import type { EvidenceFiling } from "./evidence-pack";
import { parseFilingRecord } from "./filing-record";

const FILED = new Set(["submitted", "confirmed"]);

export async function loadEvidenceFiling(db: Db, report: Report): Promise<EvidenceFiling | null> {
  if (!FILED.has(report.status)) return null;
  const [approval] = report.approvalId
    ? await db.select({ approvedBy: approvals.approvedBy, approvedAt: approvals.approvedAt }).from(approvals).where(eq(approvals.id, report.approvalId))
    : [];
  const common = {
    portal: `Replica ${report.state} holder portal`,
    confirmation: report.replicaConfirmation,
    checksum: report.checksum,
    submittedAt: report.submittedAt?.toISOString() ?? null,
  };
  const rec = parseFilingRecord(report.filingRecord);
  if (rec) {
    return {
      ...common,
      approvedBy: rec.approvedBy,
      approvedAt: rec.approvedAt ?? approval?.approvedAt?.toISOString() ?? null,
      reportDue: rec.reportDue,
      daysLate: rec.daysLate,
      interest: rec.interest,
      remitDue: rec.remitDue,
      remittance: await loadRemittance(db, report.companyId, report.state, report.id),
      frozenAsOf: rec.asOf,
      stage: { name: rec.stage, remits: rec.stageRemits },
      nextStage: rec.nextStage,
      unverifiedRuleCount: rec.unverifiedRuleCount,
      unverifiedAcknowledged: rec.unverifiedAcknowledged,
      unsentNotices: rec.unsentNotices,
      unsentAcknowledged: rec.unsentAcknowledged,
      warningCount: rec.warningCount,
      signIn: rec.signIn,
    };
  }
  // Filed before filing records: the receipt's live figures, which exist only for the state's latest report.
  const receipt = (await buildRunner(db, report.companyId, report.state)).receipt;
  const r = receipt?.reportId === report.id ? receipt : null;
  return {
    ...common,
    approvedBy: approverName(approval?.approvedBy),
    approvedAt: approval?.approvedAt?.toISOString() ?? null,
    reportDue: r?.reportDue ? { date: r.reportDue, unverified: r.reportDueUnverified } : null,
    daysLate: r?.daysLate ?? null,
    interest: r ? r.interest : { status: "unknown", reason: "Lateness is shown only for the state's latest filing" },
    remitDue: r?.remitDue ? { date: r.remitDue, unverified: r.remitDueUnverified } : null,
    remittance: r?.remittance ?? null,
  };
}
