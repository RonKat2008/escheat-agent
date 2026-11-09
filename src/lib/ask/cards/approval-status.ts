/**
 * R11-02: the current server-side approval state of one Ask card row. A restored transcript (session storage) still
 * holds the props the card was first rendered with, so on mount the card asks this (a GET, never a POST) and shows
 * "Approved by <name>" instead of a second Approve button when the row was approved since.
 *
 * Server-only (reads the database).
 */
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { approvals, outreach, recoveries, reports } from "@/db/schema";
import { approverName } from "@/lib/auth/approver";

export type CardApprovalSubject = "outreach" | "report" | "claim";

export interface CardApprovalStatus {
  approved: boolean;
  /** The typed name of the person who approved it (no session suffix); null when not approved. */
  approvedBy: string | null;
  approvedAt: string | null;
}

const NOT_APPROVED: CardApprovalStatus = { approved: false, approvedBy: null, approvedAt: null };

/** Statuses in which the row still waits for a person; anything later has been approved (and maybe sent or filed). */
const WAITING: Record<CardApprovalSubject, ReadonlySet<string>> = {
  outreach: new Set(["draft", "awaiting_approval"]),
  report: new Set(["draft", "validated", "awaiting_approval"]),
  claim: new Set(["found", "claim_drafted", "awaiting_approval"]),
};

async function subjectRow(db: Db, kind: CardApprovalSubject, id: string): Promise<{ status: string; approvalId: string | null } | null> {
  if (kind === "outreach") {
    const [row] = await db.select({ status: outreach.status, approvalId: outreach.approvalId }).from(outreach).where(eq(outreach.id, id));
    return row ?? null;
  }
  if (kind === "report") {
    const [row] = await db.select({ status: reports.status, approvalId: reports.approvalId }).from(reports).where(eq(reports.id, id));
    return row ?? null;
  }
  const [row] = await db.select({ status: recoveries.status, approvalId: recoveries.approvalId }).from(recoveries).where(eq(recoveries.id, id));
  return row ?? null;
}

/** Null when the row does not exist. */
export async function cardApprovalStatus(db: Db, kind: CardApprovalSubject, id: string): Promise<CardApprovalStatus | null> {
  const row = await subjectRow(db, kind, id);
  if (!row) return null;
  if (!row.approvalId) return NOT_APPROVED;
  const [a] = await db.select().from(approvals).where(eq(approvals.id, row.approvalId));
  if (!a?.approvedAt) return NOT_APPROVED;
  // A voided approval (the draft was recomposed) is consumed while the row waits again: it no longer counts. An
  // unconsumed one counts even while the status still reads "awaiting_approval" (approveClaim leaves it there).
  if (a.consumedAt !== null && WAITING[kind].has(row.status)) return NOT_APPROVED;
  return { approved: true, approvedBy: approverName(a.approvedBy) ?? "a person", approvedAt: a.approvedAt.toISOString() };
}
