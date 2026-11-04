/**
 * The Filing section of the evidence pack (R5-12): the same facts the close-out receipt shows, read from the same
 * place (the runner's receipt for the state's latest report), plus the approval row the filing was bound to.
 * Read-only. Returns null until the report is submitted, so a pack made before filing says "not filed yet".
 */
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { approvals, type Report } from "@/db/schema";
import { buildRunner } from "@/lib/close-out/runner";
import type { EvidenceFiling } from "./evidence-pack";

const FILED = new Set(["submitted", "confirmed"]);

export async function loadEvidenceFiling(db: Db, report: Report): Promise<EvidenceFiling | null> {
  if (!FILED.has(report.status)) return null;
  const [approval] = report.approvalId
    ? await db.select({ approvedBy: approvals.approvedBy, approvedAt: approvals.approvedAt }).from(approvals).where(eq(approvals.id, report.approvalId))
    : [];
  // Lateness and interest are the receipt's own figures; they exist only for the state's latest report.
  const receipt = (await buildRunner(db, report.companyId, report.state)).receipt;
  const r = receipt?.reportId === report.id ? receipt : null;
  return {
    portal: `Replica ${report.state} holder portal`,
    confirmation: report.replicaConfirmation,
    checksum: report.checksum,
    approvedBy: approval?.approvedBy ?? null,
    approvedAt: approval?.approvedAt?.toISOString() ?? null,
    submittedAt: report.submittedAt?.toISOString() ?? null,
    reportDue: r?.reportDue ? { date: r.reportDue, unverified: r.reportDueUnverified } : null,
    daysLate: r?.daysLate ?? null,
    interest: r ? r.interest : { status: "unknown", reason: "Lateness is shown only for the state's latest filing" },
    remitDue: r?.remitDue ? { date: r.remitDue, unverified: r.remitDueUnverified } : null,
    remittance: r?.remittance ?? null,
  };
}
