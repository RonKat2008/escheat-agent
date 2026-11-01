import { and, count, eq, inArray, isNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import { outreach, recoveries, reports, ruleChanges } from "@/db/schema";

/** Outreach statuses that still need a human (draft to approve, approved to send, failed to retry). */
export const ACTIONABLE_OUTREACH = ["draft", "awaiting_approval", "approved", "failed"] as const;
/** Report statuses that are listed in the queue and still unapproved. */
export const ACTIONABLE_REPORT = ["validated", "awaiting_approval"] as const;
/** Recovery statuses that are listed in the queue; a claim with an approval attached is no longer waiting. */
export const ACTIONABLE_RECOVERY = ["found", "claim_drafted", "awaiting_approval"] as const;

/**
 * How many things wait on a human: the single definition behind the pink sidebar badge and the Approvals list header
 * ("Waiting on you"). It must stay in step with `actionable` in queue-data.ts; queue-count.test.ts compares the two.
 */
export async function countWaiting(db: Db, companyId: string): Promise<number> {
  const one = async (q: Promise<{ n: number }[]>) => Number((await q)[0]?.n ?? 0);
  const [o, r, c, x] = await Promise.all([
    one(db.select({ n: count() }).from(outreach).where(and(eq(outreach.companyId, companyId), inArray(outreach.status, [...ACTIONABLE_OUTREACH])))),
    one(db.select({ n: count() }).from(reports).where(and(eq(reports.companyId, companyId), inArray(reports.status, [...ACTIONABLE_REPORT])))),
    one(
      db
        .select({ n: count() })
        .from(recoveries)
        .where(and(eq(recoveries.companyId, companyId), inArray(recoveries.status, [...ACTIONABLE_RECOVERY]), isNull(recoveries.approvalId))),
    ),
    one(db.select({ n: count() }).from(ruleChanges).where(eq(ruleChanges.status, "proposed"))),
  ]);
  return o + r + c + x;
}
