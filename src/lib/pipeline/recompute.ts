/**
 * Recompute every stale item's dates from the CURRENT rule files, flag moved deadlines, and advance
 * statuses with the pure machine at the simulated "today". Side effects are limited to outreach DRAFT rows.
 */
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { companies, ledgerItems, staleItems, type Company, type LedgerItem, type StaleItem, type StaleStatus } from "@/db/schema";
import * as clock from "@/lib/clock";
import type { IsoDate } from "@/lib/dates";
import type { MachineAction } from "@/lib/timeline/machine";
import {
  TERMINAL_STATUSES,
  applyActions,
  computeItemTimeline,
  deadlinesMoved,
  decideStatus,
  type ComputedTimeline,
} from "./compute";

export interface Transition {
  staleItemId: string;
  from: StaleStatus;
  to: StaleStatus;
  actions: MachineAction[];
  deadlineMoved: boolean;
  outreachDraftCreated: boolean;
}

export interface RecomputeResult {
  today: string;
  processed: number;
  deadlinesMoved: number;
  transitions: Transition[];
}

export interface ItemRecomputePlan {
  timeline: ComputedTimeline;
  status: StaleStatus;
  actions: MachineAction[];
  deadlineMoved: boolean;
}

/** Pure: what the deterministic recompute would set for one stale item (no DB access, no side effects). */
export function planItemRecompute(
  row: Pick<StaleItem, "ownerState" | "propertyType" | "lastActivityDate" | "amountCents" | "staleSince" | "status"> &
    Partial<Record<"presumedAbandonedDate" | "ddWindowStart" | "ddWindowEnd" | "reportDueDate" | "remitDueDate", string | null>>,
  ledger: Pick<LedgerItem, "lastActivityDate" | "issueDate"> | undefined,
  company: Pick<Company, "fiscalYearEnd">,
  today: IsoDate,
): ItemRecomputePlan {
  const lastActivity = (row.lastActivityDate ?? ledger?.lastActivityDate ?? ledger?.issueDate ?? row.staleSince) as IsoDate;
  const timeline = computeItemTimeline({
    ownerState: row.ownerState,
    propertyType: row.propertyType,
    lastActivityDate: lastActivity,
    amountCents: row.amountCents,
    holderFiscalYearEnd: company.fiscalYearEnd,
  });
  const decision = decideStatus({ status: row.status, ...timeline.dates }, timeline.ddApplies, today);
  return { timeline, status: decision.status, actions: decision.actions, deadlineMoved: deadlinesMoved(row, timeline.dates) };
}

export interface RecomputeOptions {
  /** Restrict to these stale item ids (e.g. the items a payee change touched). Default: every item. */
  only?: ReadonlySet<string>;
}

export async function recomputeTimelines(db: Db, companyId: string, opts: RecomputeOptions = {}): Promise<RecomputeResult> {
  const today = await clock.now(db, companyId);
  const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
  if (!company) throw new Error(`Unknown company ${companyId}`);
  const rows = await db.select().from(staleItems).where(eq(staleItems.companyId, companyId));
  const transitions: Transition[] = [];
  let processed = 0;
  let moved = 0;

  for (const row of rows) {
    if (TERMINAL_STATUSES.has(row.status)) continue;
    if (opts.only && !opts.only.has(row.id)) continue;
    processed++;
    const [ledger] = await db.select().from(ledgerItems).where(eq(ledgerItems.id, row.ledgerItemId));
    const plan = planItemRecompute(row, ledger, company, today);
    const tl = plan.timeline;
    const didMove = plan.deadlineMoved;
    const decision = { status: plan.status, actions: plan.actions };
    const nextCls = {
      ...(row.classification ?? {}),
      timeline: tl.summary,
    };
    await db
      .update(staleItems)
      .set({
        ...tl.dates,
        status: decision.status,
        propertyCode: tl.propertyCode ?? row.propertyCode,
        classification: nextCls,
        ...(didMove ? { deadlineMovedAt: new Date() } : {}),
      })
      .where(eq(staleItems.id, row.id));
    const { outreachCreated } = await applyActions(db, row, decision.actions);
    if (didMove) moved++;
    if (decision.status !== row.status || didMove) {
      transitions.push({
        staleItemId: row.id,
        from: row.status,
        to: decision.status,
        actions: decision.actions,
        deadlineMoved: didMove,
        outreachDraftCreated: outreachCreated,
      });
    }
  }
  return { today, processed, deadlinesMoved: moved, transitions };
}
