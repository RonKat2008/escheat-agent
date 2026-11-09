/**
 * The one place an Ask card turns an Approve click into a request. It targets the SAME endpoints, with the SAME body,
 * as the Approvals page (approvals/OutreachDetail.tsx, approvals/OtherDetails.tsx): the server re-checks the session,
 * the typed approver name and the hash, records the approval with requireApproval/approve, and appends the audit-chain
 * event. A card never approves, sends, files or closes anything itself. Proven by approval-equivalence.db.test.ts.
 *
 * Pure; client-safe.
 */
import type { CardApproval } from "./approval-ui-types";

export interface ApprovalRequest {
  url: string;
  body: Record<string, string | number | null>;
}

/**
 * @param acknowledged reports only: the person ticked "approve anyway" for the counts shown (the server re-derives
 *   them and refuses a stale or missing acknowledgement with 409).
 */
export function approvalRequest(a: CardApproval, approvedBy: string, acknowledged = false): ApprovalRequest {
  const name = approvedBy.trim();
  switch (a.kind) {
    case "outreach":
      return { url: `/api/outreach/${a.outreachId}/approve`, body: { approvedBy: name, expectedContentSha256: a.contentSha256 } };
    case "report":
      return {
        url: `/api/reports/${a.reportId}/approve`,
        body: {
          approvedBy: name,
          expectedChecksum: a.checksum,
          acknowledgedUnverified: acknowledged ? a.unverified : null,
          acknowledgedUnsent: acknowledged ? a.unsent : null,
        },
      };
    case "claim":
      return { url: `/api/recoveries/${a.recoveryId}/approve`, body: { approvedBy: name, expectedPayloadSha256: a.payloadSha256 } };
  }
}

/** A report approval must acknowledge UNVERIFIED rule values or never-sent notices ("approve anyway"). */
export const needsAcknowledgement = (a: CardApproval): boolean => a.kind === "report" && (a.unverified > 0 || a.unsent > 0);

/** The close request, identical to ledger/ClosePackButton.tsx: typed name bound to the journal hash shown. */
export function closeRequest(period: string, approvedBy: string, journalSha256: string): ApprovalRequest {
  return { url: "/api/close-pack", body: { period, approvedBy: approvedBy.trim(), expectedJournalSha256: journalSha256 } };
}
