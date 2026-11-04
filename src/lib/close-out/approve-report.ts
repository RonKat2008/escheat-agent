/**
 * R5-04: the runner's report approval. Same server path as Reports (approveReport: typed approver, checksum bound),
 * plus one gate the runner adds: when the cycle relies on UNVERIFIED rule values, or (R6-09) a required
 * due-diligence notice for an item in the file never went out, the person must acknowledge exactly how many
 * ("approve anyway"). The counts are re-derived here from the records, never trusted from the browser, and a stale or
 * missing acknowledgement is refused before anything is approved. approveReport freezes the acknowledged counts on
 * the filing record (R6-07).
 */
import type { Db } from "@/db/client";
import type { Report } from "@/db/schema";
import type { SignIn } from "@/lib/reports/filing-record";
import { approveReport } from "@/lib/reports/service";
import { loadUnsentNotices, reportItemsOf } from "./filing-record";
import { loadCloseSnapshot } from "./plan";

export class RunnerApprovalError extends Error {
  constructor(
    public readonly code: "unverified_not_acknowledged" | "unsent_not_acknowledged" | "not_this_report",
    message: string,
  ) {
    super(message);
    this.name = "RunnerApprovalError";
  }
}

export interface RunnerApproveInput {
  companyId: string;
  state: string;
  reportId: string;
  approvedBy: string;
  expectedChecksum: string;
  /** The unverified count the person saw and acknowledged; null/absent = no acknowledgement. */
  acknowledgedUnverified?: number | null;
  /** R6-09: the never-sent notice count the person saw and acknowledged. */
  acknowledgedUnsent?: number | null;
  signIn?: SignIn | null;
}

/** Pure: does this acknowledgement cover the live count? Zero needs none. */
export function acknowledgementCovers(count: number, acknowledged: number | null | undefined): boolean {
  return count === 0 || acknowledged === count;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export async function approveReportFromRunner(
  db: Db,
  input: RunnerApproveInput,
): Promise<{ report: Report; unverifiedAcknowledged: number; unsentAcknowledged: number }> {
  const snap = await loadCloseSnapshot(db, input.companyId, input.state);
  if (!snap.report || snap.report.id !== input.reportId) {
    throw new RunnerApprovalError("not_this_report", `That is not the current ${snap.state} report. Reload the runner.`);
  }
  const unverified = snap.unverifiedRulePaths.length;
  if (!acknowledgementCovers(unverified, input.acknowledgedUnverified)) {
    throw new RunnerApprovalError(
      "unverified_not_acknowledged",
      `This file relies on ${plural(unverified, "UNVERIFIED rule value", "UNVERIFIED rule values")}. Tick "approve anyway" to acknowledge ${unverified === 1 ? "it" : "them"}, or verify the rules first.`,
    );
  }
  const unsent = (await loadUnsentNotices(db, input.companyId, reportItemsOf(snap))).length;
  if (!acknowledgementCovers(unsent, input.acknowledgedUnsent)) {
    throw new RunnerApprovalError(
      "unsent_not_acknowledged",
      `${plural(unsent, "required due-diligence notice", "required due-diligence notices")} for items in this file never went out. Tick "approve anyway" to acknowledge ${unsent === 1 ? "it" : "them"}.`,
    );
  }
  const report = await approveReport(db, input.reportId, input.approvedBy, {
    expectedChecksum: input.expectedChecksum,
    acknowledgedUnverified: unverified,
    acknowledgedUnsent: unsent,
    signIn: input.signIn ?? null,
  });
  return { report, unverifiedAcknowledged: unverified, unsentAcknowledged: unsent };
}
