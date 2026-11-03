import { and, count, eq, inArray, isNull, sum } from "drizzle-orm";
import type { Db } from "@/db/client";
import { outreach, recoveries, reports, ruleChanges, staleItems } from "@/db/schema";

/** Outreach statuses that still need a human (draft to approve, approved to send, failed to retry). */
export const ACTIONABLE_OUTREACH = ["draft", "awaiting_approval", "approved", "failed"] as const;
/** Report statuses that are listed in the queue and still unapproved. */
export const ACTIONABLE_REPORT = ["validated", "awaiting_approval"] as const;
/** Recovery statuses that are listed in the queue; a claim with an approval attached is no longer waiting. */
export const ACTIONABLE_RECOVERY = ["found", "claim_drafted", "awaiting_approval"] as const;
/**
 * An owner answered their (sent) notice: the holder now owes a follow-up (verify and reissue, check the bank, or use the
 * new address) and records it with "Mark resolved". The item leaves the queue when it is resolved_paid.
 */
export const OWNER_TASK_STATUS = "owner_responded" as const;

export interface WaitingTally {
  count: number;
  cents: number;
}

/** Everything that waits on a person, per source. One derivation for the badge, the list header and the pipeline gate. */
export interface WaitingBreakdown {
  outreach: WaitingTally;
  reports: WaitingTally;
  recoveries: WaitingTally;
  ruleChanges: number;
  ownerTasks: WaitingTally;
  total: number;
}

const tally = (rows: { n: unknown; cents?: unknown }[]): WaitingTally => ({ count: Number(rows[0]?.n ?? 0), cents: Number(rows[0]?.cents ?? 0) });

export async function waitingBreakdown(db: Db, companyId: string): Promise<WaitingBreakdown> {
  const [o, r, c, x, t] = await Promise.all([
    db
      .select({ n: count(), cents: sum(staleItems.amountCents) })
      .from(outreach)
      .innerJoin(staleItems, eq(staleItems.id, outreach.staleItemId))
      .where(and(eq(outreach.companyId, companyId), inArray(outreach.status, [...ACTIONABLE_OUTREACH]))),
    db
      .select({ n: count(), cents: sum(reports.totalCents) })
      .from(reports)
      .where(and(eq(reports.companyId, companyId), inArray(reports.status, [...ACTIONABLE_REPORT]))),
    db
      .select({ n: count(), cents: sum(recoveries.amountCents) })
      .from(recoveries)
      .where(and(eq(recoveries.companyId, companyId), inArray(recoveries.status, [...ACTIONABLE_RECOVERY]), isNull(recoveries.approvalId))),
    db.select({ n: count() }).from(ruleChanges).where(eq(ruleChanges.status, "proposed")),
    db
      .select({ n: count(), cents: sum(staleItems.amountCents) })
      .from(staleItems)
      .where(and(eq(staleItems.companyId, companyId), eq(staleItems.status, OWNER_TASK_STATUS))),
  ]);
  const b = { outreach: tally(o), reports: tally(r), recoveries: tally(c), ruleChanges: tally(x).count, ownerTasks: tally(t) };
  return { ...b, total: b.outreach.count + b.reports.count + b.recoveries.count + b.ruleChanges + b.ownerTasks.count };
}

/**
 * How many things wait on a human: the single definition behind the pink sidebar badge, the Approvals list header
 * ("Waiting on you") and the pipeline's "Awaiting you" gate. It must stay in step with `actionable` in queue-data.ts;
 * queue-count.test.ts compares the three.
 */
export async function countWaiting(db: Db, companyId: string): Promise<number> {
  return (await waitingBreakdown(db, companyId)).total;
}

/** Owner replies the holder still has to act on (dashboard "Needs you"); the same set the approvals desk lists. */
export async function countOwnerTasks(db: Db, companyId: string): Promise<WaitingTally> {
  const rows = await db
    .select({ n: count(), cents: sum(staleItems.amountCents) })
    .from(staleItems)
    .where(and(eq(staleItems.companyId, companyId), eq(staleItems.status, OWNER_TASK_STATUS)));
  return tally(rows);
}
