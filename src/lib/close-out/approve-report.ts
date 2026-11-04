/**
 * R5-04: the runner's report approval. Same server path as Reports (approveReport: typed approver, checksum bound),
 * plus one gate the runner adds: when the cycle relies on UNVERIFIED rule values, the person must acknowledge exactly
 * how many ("approve anyway"). The count is re-derived here from the records, never trusted from the browser, and a
 * stale or missing acknowledgement is refused before anything is approved.
 */
import type { Db } from "@/db/client";
import type { Report } from "@/db/schema";
import { approveReport } from "@/lib/reports/service";
import { loadCloseSnapshot } from "./plan";

export class RunnerApprovalError extends Error {
  constructor(
    public readonly code: "unverified_not_acknowledged" | "not_this_report",
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
}

/** Pure: does this acknowledgement cover the live unverified count? Zero unverified values need none. */
export function acknowledgementCovers(unverified: number, acknowledged: number | null | undefined): boolean {
  return unverified === 0 || acknowledged === unverified;
}

export async function approveReportFromRunner(db: Db, input: RunnerApproveInput): Promise<{ report: Report; unverifiedAcknowledged: number }> {
  const snap = await loadCloseSnapshot(db, input.companyId, input.state);
  if (!snap.report || snap.report.id !== input.reportId) {
    throw new RunnerApprovalError("not_this_report", `That is not the current ${snap.state} report. Reload the runner.`);
  }
  const unverified = snap.unverifiedRulePaths.length;
  if (!acknowledgementCovers(unverified, input.acknowledgedUnverified)) {
    throw new RunnerApprovalError(
      "unverified_not_acknowledged",
      `This file relies on ${unverified} UNVERIFIED rule ${unverified === 1 ? "value" : "values"}. Tick "approve anyway" to acknowledge ${unverified === 1 ? "it" : "them"}, or verify the rules first.`,
    );
  }
  const report = await approveReport(db, input.reportId, input.approvedBy, { expectedChecksum: input.expectedChecksum });
  return { report, unverifiedAcknowledged: unverified };
}
