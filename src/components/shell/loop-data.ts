/**
 * Loop Bar data (DESIGN-V3 §5.1): live counts for Triage -> Draft -> Approve -> File, plus the inputs of the next best
 * action (§5.2). Every number is a COUNT over real rows; nothing is estimated. Server-only (it takes a Db).
 */
import { cache } from "react";
import { and, count, eq, gte, inArray, isNotNull, lte, min, notExists, notInArray, or, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { Db } from "@/db/client";
import { agentRuns, ledgerItems, outreach, reports, staleItems } from "@/db/schema";
import { countWaiting } from "@/app/(app)/approvals/queue-count";
import { addDays, type IsoDate } from "@/lib/dates";
import { nextAction, URGENT_DAYS, type LoopCounts, type NextAction, type NextActionInput } from "@/lib/next-action";
import { CLOSED_STATUSES, today } from "@/lib/queries/common";
import { getNeedsActionIds } from "@/lib/queries/needs-action";

export type LoopStageId = "triage" | "draft" | "approve" | "file";

export interface LoopData {
  asOf: IsoDate;
  counts: LoopCounts;
  /** An agent run is in progress right now (blue glow-live dot). */
  running: number;
  next: NextAction;
  input: NextActionInput;
}

/** Statuses after which an item needs nothing more from the loop (closed, or already reported to the state). */
const DONE_STATUSES = [...CLOSED_STATUSES, "reported"] as const;
/** Outreach that counts as "a draft exists" for an item; a cancelled or failed letter does not. */
const LIVE_OUTREACH = ["draft", "awaiting_approval", "approved", "sent", "delivered", "responded"] as const;
/** Outreach still waiting on a person (mirrors ACTIONABLE_OUTREACH in approvals/queue-count.ts). */
const WAITING_OUTREACH = ["draft", "awaiting_approval", "approved", "failed"] as const;

const n = (rows: { n: number | string | null }[]): number => Number(rows[0]?.n ?? 0);

/** The earliest of an item's legal deadlines on or after `from` (SQL expression). */
function nearestDeadlineSql(from: IsoDate) {
  const col = (c: AnyPgColumn) => sql`case when ${c} >= ${from} then ${c} end`;
  return sql<string | null>`least(${col(staleItems.ddWindowEnd)}, ${col(staleItems.reportDueDate)}, ${col(staleItems.remitDueDate)})`;
}

export async function getLoopData(db: Db, companyId: string): Promise<LoopData> {
  const asOf = await today(db, companyId);
  const soon = addDays(asOf, URGENT_DAYS);
  const open = notInArray(staleItems.status, [...DONE_STATUSES]);
  const ofCompany = eq(staleItems.companyId, companyId);

  const [ledgerRows, triageRows, draftRows, approve, fileRows, runningRows, unverifiedRows, urgentRows, nextRows] = await Promise.all([
    db.select({ n: count() }).from(ledgerItems).where(eq(ledgerItems.companyId, companyId)),
    // Triage: the shared "needs action" set (overdue, DD letter due, needing a rule, or flagged for review; R5-14).
    getNeedsActionIds(db, companyId).then((ids) => [{ n: ids.size }]),
    // Draft: items inside an open due-diligence window with no live outreach yet.
    db
      .select({ n: count() })
      .from(staleItems)
      .where(
        and(
          ofCompany,
          open,
          isNotNull(staleItems.ddWindowStart),
          lte(staleItems.ddWindowStart, asOf),
          or(sql`${staleItems.ddWindowEnd} is null`, gte(staleItems.ddWindowEnd, asOf)),
          notExists(
            db
              .select({ one: sql`1` })
              .from(outreach)
              .where(and(eq(outreach.staleItemId, staleItems.id), inArray(outreach.status, [...LIVE_OUTREACH]))),
          ),
        ),
      ),
    // Approve: the same single definition as the pink nav badge and the Approvals header.
    countWaiting(db, companyId),
    // File: reports approved but not yet submitted.
    db.select({ n: count() }).from(reports).where(and(eq(reports.companyId, companyId), eq(reports.status, "approved"))),
    db.select({ n: count() }).from(agentRuns).where(and(eq(agentRuns.companyId, companyId), eq(agentRuns.status, "running"))),
    db.select({ n: count() }).from(staleItems).where(and(ofCompany, open, eq(staleItems.dependsOnUnverified, true))),
    // Waiting approvals whose item has a deadline within 7 days.
    db
      .select({ n: sql<number>`count(distinct ${outreach.id})`, first: min(nearestDeadlineSql(asOf)) })
      .from(outreach)
      .innerJoin(staleItems, eq(staleItems.id, outreach.staleItemId))
      .where(
        and(
          eq(outreach.companyId, companyId),
          inArray(outreach.status, [...WAITING_OUTREACH]),
          sql`${nearestDeadlineSql(asOf)} <= ${soon}`,
        ),
      ),
    db.select({ first: min(nearestDeadlineSql(asOf)) }).from(staleItems).where(and(ofCompany, open)),
  ]);

  const hasLedger = n(ledgerRows) > 0;
  const counts: LoopCounts = hasLedger
    ? { triage: n(triageRows), draft: n(draftRows), approve, file: n(fileRows) }
    : { triage: null, draft: null, approve: approve || null, file: null };
  const input: NextActionInput = {
    counts,
    asOf,
    urgentApprovals: Number(urgentRows[0]?.n ?? 0),
    urgentDeadline: (urgentRows[0]?.first ?? null) as IsoDate | null,
    unverifiedBlocking: n(unverifiedRows),
    nextDeadline: (nextRows[0]?.first ?? null) as IsoDate | null,
  };
  return { asOf, counts, running: n(runningRows), next: nextAction(input), input };
}

/** Per-request cached loop data for server components (the Loop Bar and the pill share one read). */
export const loadLoopData = cache(async (): Promise<LoopData> => {
  const { getCtx } = await import("@/lib/ui/ctx");
  const { db, companyId } = await getCtx();
  return getLoopData(db, companyId);
});
