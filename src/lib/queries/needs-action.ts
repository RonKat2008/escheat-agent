/**
 * The one definition of "needs action" (R5-14): the Items "Needs action" view and the Loop Bar Triage count both read
 * it, so they always agree, and neither can leave out the item the dashboard calls the first thing to do.
 *
 * An open item needs action when it is past a deadline (the shared overdue assessment, src/lib/overdue.ts via
 * getOverdue, including a reported item whose remittance is late), its due-diligence letter is due (dd_pending), a rule
 * value is missing (needs_rule), or its classification is flagged for review.
 */
import { and, eq, inArray, notInArray, or } from "drizzle-orm";
import type { Db } from "@/db/client";
import { staleItems } from "@/db/schema";
import { CLOSED_STATUSES } from "./common";
import { getOverdue } from "./overdue";

/** Closed, or already reported to the state: nothing left for triage unless a remittance is late (overdue). */
const DONE_STATUSES = [...CLOSED_STATUSES, "reported"] as const;

export async function getNeedsActionIds(db: Db, companyId: string): Promise<ReadonlySet<string>> {
  const [triage, overdue] = await Promise.all([
    db
      .select({ id: staleItems.id })
      .from(staleItems)
      .where(
        and(
          eq(staleItems.companyId, companyId),
          notInArray(staleItems.status, [...DONE_STATUSES]),
          or(inArray(staleItems.status, ["dd_pending", "needs_rule"]), eq(staleItems.needsReview, true)),
        ),
      ),
    getOverdue(db, companyId),
  ]);
  return new Set([...triage.map((r) => r.id), ...overdue.items.map((i) => i.itemId)]);
}
