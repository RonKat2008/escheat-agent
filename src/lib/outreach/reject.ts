import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { outreach, type Outreach } from "@/db/schema";
import { OutreachStateError } from "./errors";
import { loadOutreach, mergeTracking } from "./util";

/** Only drafts that were never approved can be discarded (a blocked letter is a draft whose readiness check failed). */
export const REJECTABLE_STATUSES: readonly Outreach["status"][] = ["draft", "awaiting_approval"];


/**
 * R6-20a: a person discards an outreach draft. The row goes to "cancelled" (nothing is sent, the item is free to get a
 * new draft) and the rejection (who, why, when) is kept on the row's tracking, which the queue and the audit trail read.
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
  const [saved] = await db
    .update(outreach)
    .set({
      status: "cancelled",
      tracking: mergeTracking(row.tracking, { rejected: { by: rejectedBy, reason: reason.trim(), at: now.toISOString(), fromStatus: row.status } }),
    })
    .where(eq(outreach.id, outreachId))
    .returning();
  return { outreachId, status: saved!.status };
}
