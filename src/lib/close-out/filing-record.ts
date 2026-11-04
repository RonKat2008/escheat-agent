/**
 * Builds the frozen filing record (reports/filing-record.ts) from the records at the moment a person approves the
 * report. Read-only: the caller (approveReport) writes it once, together with the approval. Every figure comes from
 * the same helpers the runner shows before approval, so what the person saw is what gets frozen (R6-07).
 */
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { ledgerItems, outreach, staleItems, type Report } from "@/db/schema";
import { composeStateOf } from "@/lib/outreach/bulk";
import { getOverdue } from "@/lib/queries";
import { nextStageOf, stageOf, type FilingRecord, type SignIn, type SourcedDate, type UnsentNotice } from "@/lib/reports/filing-record";
import { summarizeLateMoney, type StateInterest } from "@/lib/reports/late-money";
import type { ValidationError } from "@/lib/reports/validate";
import { summarizeValidation } from "@/lib/reports/validation-summary";
import { tryLoadRules } from "@/lib/rules/load";
import type { CloseSnapshot, SnapshotItem } from "./derive";
import { loadCloseSnapshot, type SnapshotStage } from "./plan";
import { isFollowUpReport } from "./remit-stage";
import { daysBetween } from "./runner-model";

/** The snapshot a report belongs to: its remit stage, or its regular cycle. */
export const snapshotStageOf = (report: Pick<Report, "state" | "stage">): SnapshotStage => (isFollowUpReport(report) ? "follow_up" : "cycle");

const SENT = new Set(["sent", "delivered", "responded"]);

/** The live late facts of a cycle's report items (To Report before filing): the runner shows these before approval. */
export interface CycleLate {
  reportDue: string | null;
  reportDueUnverified: boolean;
  daysLate: number | null;
  interest: StateInterest;
  remitDue: string | null;
  remitDueUnverified: boolean;
}

/** The items a report covers before filing: the To Report pool, or the reported items once filed (pre-record reports). */
export const reportItemsOf = (snap: CloseSnapshot): SnapshotItem[] => snap.items.filter((i) => i.status === "to_report" || i.status === "reported");

export async function loadCycleLate(db: Db, companyId: string, snap: CloseSnapshot): Promise<CycleLate> {
  const filed = reportItemsOf(snap);
  const minDate = (xs: (string | null)[]) => xs.filter((d): d is string => !!d).sort()[0] ?? null;
  const due = minDate(filed.map((i) => i.reportDueDate));
  const remitDue = minDate(filed.map((i) => i.remitDueDate));
  const overdue = await getOverdue(db, companyId, { states: [snap.state] });
  const late = summarizeLateMoney(overdue.items, (s) => tryLoadRules(s)?.file ?? null, overdue.asOf).byState.find((b) => b.state === snap.state);
  const unverified = filed.some((i) => i.dependsOnUnverified);
  return {
    reportDue: due,
    reportDueUnverified: unverified,
    daysLate: due && due < snap.asOf ? daysBetween(due, snap.asOf) : null,
    interest: late?.interest ?? { status: "none" },
    remitDue,
    remitDueUnverified: unverified,
  };
}

function unsentReason(letters: readonly (typeof outreach.$inferSelect)[]): string {
  const live = letters.filter((l) => l.status !== "cancelled" && l.status !== "failed");
  const latest = live[live.length - 1];
  if (!latest) return letters.length ? `the letter was ${letters[letters.length - 1]!.status}` : "no letter was drafted";
  if (latest.status === "approved") return "approved but never sent";
  const c = composeStateOf(latest);
  if (c.composed && !c.ready && c.problems[0]) return `blocked: ${c.problems[0]}`;
  return c.composed ? "drafted but never approved" : "drafted but never composed";
}

/**
 * R6-09: items whose due-diligence window applied (the engine set a window end) but whose owner notice never went out.
 * Pass the items the report covers.
 */
export async function loadUnsentNotices(db: Db, companyId: string, items: readonly SnapshotItem[]): Promise<UnsentNotice[]> {
  const owed = items.filter((i) => i.ddWindowEnd !== null);
  if (owed.length === 0) return [];
  const ids = owed.map((i) => i.id);
  const [letters, names] = await Promise.all([
    db
      .select()
      .from(outreach)
      .where(and(eq(outreach.companyId, companyId), eq(outreach.channel, "letter"), inArray(outreach.staleItemId, ids)))
      .orderBy(outreach.createdAt, outreach.id),
    db
      .select({ id: staleItems.id, payeeName: ledgerItems.payeeNameRaw })
      .from(staleItems)
      .innerJoin(ledgerItems, eq(ledgerItems.id, staleItems.ledgerItemId))
      .where(inArray(staleItems.id, ids)),
  ]);
  const nameOf = new Map(names.map((n) => [n.id, n.payeeName]));
  return owed
    .map((i) => ({ item: i, mine: letters.filter((l) => l.staleItemId === i.id) }))
    .filter(({ mine }) => !mine.some((l) => SENT.has(l.status)))
    .map(({ item, mine }) => ({
      staleItemId: item.id,
      payeeName: nameOf.get(item.id) ?? "Unknown payee",
      amountCents: item.amountCents,
      windowClosed: item.ddWindowEnd,
      reason: unsentReason(mine),
    }));
}

export interface DraftRecordInput {
  approvedBy: string;
  /** Unverified count the person acknowledged ("approve anyway"); null = not asked (approved from Reports). */
  acknowledgedUnverified?: number | null;
  acknowledgedUnsent?: number | null;
  signIn?: SignIn | null;
}

export type FilingRecordDraft = Omit<FilingRecord, "approvedAt" | "approvalId">;

/** The record as of now, before the approval row exists. */
export async function draftFilingRecord(db: Db, report: Report, input: DraftRecordInput, frozenAt: Date = new Date()): Promise<FilingRecordDraft> {
  // R7-01: a remit-stage report's record is the remit stage's (its cohort, due on their remit date).
  const snap = await loadCloseSnapshot(db, report.companyId, report.state, { stage: snapshotStageOf(report) });
  const [late, unsent] = await Promise.all([loadCycleLate(db, report.companyId, snap), loadUnsentNotices(db, report.companyId, reportItemsOf(snap))]);
  const rules = tryLoadRules(report.state)?.file ?? null;
  const stage = stageOf(rules, report.stage);
  const remitDue: SourcedDate | null = late.remitDue ? { date: late.remitDue, unverified: late.remitDueUnverified } : null;
  const { errorCount, warningCount } = summarizeValidation(((report.validationErrors ?? []) as ValidationError[]).filter(Boolean));
  const u = snap.unverifiedRulePaths.length;
  return {
    version: 1,
    frozenAt: frozenAt.toISOString(),
    asOf: snap.asOf,
    state: report.state,
    stage: report.stage,
    stageRemits: stage.remits,
    nextStage: stage.remits === false ? nextStageOf(rules, report.stage, remitDue) : null,
    itemCount: report.itemCount,
    totalCents: report.totalCents,
    checksum: report.checksum,
    errorCount,
    warningCount,
    reportDue: late.reportDue ? { date: late.reportDue, unverified: late.reportDueUnverified } : null,
    daysLate: late.daysLate,
    interest: late.interest,
    remitDue: stage.remits === false ? null : remitDue,
    unverifiedRuleCount: u,
    unverifiedAcknowledged: u > 0 && input.acknowledgedUnverified === u,
    unsentNotices: unsent,
    unsentAcknowledged: unsent.length > 0 && input.acknowledgedUnsent === unsent.length,
    approvedBy: input.approvedBy,
    signIn: input.signIn ?? null,
  };
}
