import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { approvals, outreach, type Outreach } from "@/db/schema";
import { requestApprovalPayloadHash } from "@/lib/approvals";
import { OutreachStateError } from "./errors";
import { loadOutreach, mergeTracking } from "./util";

/** Only drafts that were never approved can be discarded (a blocked letter is a draft whose readiness check failed). */
export const REJECTABLE_STATUSES: readonly Outreach["status"][] = ["draft", "awaiting_approval"];

/** What the person looked at when they discarded: the draft's own content and where it stood. Hashed into the audit row. */
export function discardedDraftPayload(row: Outreach) {
  return { outreachId: row.id, channel: row.channel, status: row.status, to: row.toAddress, subject: row.subject, body: row.body };
}

/**
 * R6-20a: a person discards an outreach draft. The row goes to "cancelled" (nothing is sent, the item is free to get a
 * new draft). The rejection (who, why, when) is kept on the row's tracking AND written to the approvals audit table as
 * a `discard_draft` row (approver, reason, sha256 of the discarded draft, time), which Activity and the item drawer read.
 * Refuses anything already approved or sent.
 */
export async function rejectOutreach(
  db: Db,
  outreachId: string,
  rejectedBy: string,
  reason: string,
  now: Date = new Date(),
): Promise<{ outreachId: string; status: Outreach["status"] }> {
  const row = await loadOutreach(db, outreachId);
  if (!REJECTABLE_STATUSES.includes(row.status)) {
    throw new OutreachStateError("locked", `Only a draft that has not been approved can be discarded; this one is ${row.status}.`);
  }
  const cleanReason = reason.trim();
  return db.transaction(async (tx) => {
    await tx.insert(approvals).values({
      action: "discard_draft",
      subjectId: outreachId,
      payloadSha256: requestApprovalPayloadHash(discardedDraftPayload(row)),
      approvedBy: rejectedBy,
      approvedAt: now,
      reason: cleanReason,
    });
    const [saved] = await tx
      .update(outreach)
      .set({
        status: "cancelled",
        tracking: mergeTracking(row.tracking, { rejected: { by: rejectedBy, reason: cleanReason, at: now.toISOString(), fromStatus: row.status } }),
      })
      .where(eq(outreach.id, outreachId))
      .returning();
    return { outreachId, status: saved!.status };
  });
}
