import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { outreach, type NewOutreach, type Outreach } from "@/db/schema";
import { appendAuditEvent, inTx } from "@/lib/audit/chain-db";

/**
 * Update an outreach row and append the matching audit-chain event in the same transaction (outreach.sent when a
 * letter/email/call went out or was recorded as sent offline). Returns the saved row.
 */
export async function updateOutreachAudited(db: Db, outreachId: string, set: Partial<NewOutreach>, kind: "outreach.sent"): Promise<Outreach> {
  return inTx(db, async (t) => {
    const [saved] = await t.update(outreach).set(set).where(eq(outreach.id, outreachId)).returning();
    if (!saved) throw new Error(`outreach ${outreachId} not found`);
    await appendAuditEvent(t, {
      companyId: saved.companyId,
      kind,
      subjectType: "outreach",
      subjectId: saved.id,
      occurredAt: saved.sentAt ?? new Date(),
      payload: {
        channel: saved.channel,
        status: saved.status,
        offline: saved.offline,
        approvalId: saved.approvalId,
        staleItemId: saved.staleItemId,
        providerId: saved.providerId,
        sentAt: saved.sentAt,
      },
    });
    return saved;
  });
}
