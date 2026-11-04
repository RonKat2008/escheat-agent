/**
 * R7-01: a two-stage state's SECOND stage (CA: the notice report carries no money; the remit report, due the next
 * June, does). After the notice filing its items sit in `reported`, owing money, until a person files the remit-stage
 * report on the replica portal and records the remittance. This module finds that cohort and the remit-stage report
 * that belongs to it. Read-only.
 *
 * Every date is an engine-computed column on the item (stale_items.remit_due_date); nothing here decides the law. The
 * only number of our own is REMIT_STAGE_OPENS_DAYS_BEFORE: how early the runner starts offering the remit stage. It
 * is an app scheduling setting (like a reminder), not a rule value, and it never moves a due date.
 */
import { and, asc, desc, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { reports, staleItems, type Report, type StaleItem } from "@/db/schema";
import { addDays, isIsoDate } from "@/lib/dates";
import { parseFilingRecord, stageOf, type SourcedDate } from "@/lib/reports/filing-record";
import { isReportLocked } from "@/lib/reports/reconcile";
import { tryLoadRules } from "@/lib/rules/load";
import type { RuleFile } from "../../../rules/schema";

/** The runner offers the remit stage this many days before its engine-computed due date (app setting, not law). */
export const REMIT_STAGE_OPENS_DAYS_BEFORE = 14;

export interface FollowUpStage {
  /** The stage that carries the money (CA "remit"). */
  name: string;
  /** The stage before it, already filed (CA "notice"). */
  prior: string;
  /** That stage's due rule is verified in the rule file. */
  verified: boolean;
}

/** The money-carrying stage that follows a notice-only first stage, or null (DE/TX file one stage that remits). */
export function followUpStageOf(rules: RuleFile | null, filedStage: string | null): FollowUpStage | null {
  if (!rules) return null;
  const s = stageOf(rules, filedStage ?? rules.reportStages[0]?.name ?? null);
  if (s.index < 0 || s.remits !== false) return null;
  const next = rules.reportStages[s.index + 1];
  if (!next || !next.includesRemittance) return null;
  return { name: next.name, prior: s.name!, verified: Boolean(next.dueRule.verified) };
}

/** True when a report is the follow-up (remit) stage of a two-stage state. */
export function isFollowUpReport(report: Pick<Report, "state" | "stage">): boolean {
  const rules = tryLoadRules(report.state)?.file ?? null;
  if (!rules || !report.stage) return false;
  const i = stageOf(rules, report.stage).index;
  return i > 0 && followUpStageOf(rules, rules.reportStages[i - 1]!.name)?.name === report.stage;
}

export interface RemitStage {
  state: string;
  stage: FollowUpStage;
  /** The reported items waiting on this stage (one cohort: the earliest engine remit date). */
  items: StaleItem[];
  count: number;
  totalCents: number;
  /** The cohort's engine-computed remit date (the remit report's due date); null = UNKNOWN. */
  remitDue: SourcedDate | null;
  /** When the runner starts offering it (remitDue minus REMIT_STAGE_OPENS_DAYS_BEFORE); null when the date is unknown. */
  opensOn: string | null;
  /** The runner offers the stage now: the window is open, the date passed, the date is unknown, or a report exists. */
  open: boolean;
  /** The filed notice report this cohort came from, and the demo date it was approved on. */
  noticeReport: Report | null;
  noticeFiledOn: string | null;
  /** The remit-stage report generated for this cohort (any status), or null before one is generated. */
  report: Report | null;
}

const minDate = (xs: readonly (string | null)[]): string | null => xs.filter((d): d is string => !!d).sort()[0] ?? null;

/** Demo date a filed report was approved on (its frozen record), else the stored submission date. */
export function filedOn(report: Report): string | null {
  const rec = parseFilingRecord(report.filingRecord);
  if (rec?.asOf) return rec.asOf;
  return report.submittedAt ? report.submittedAt.toISOString().slice(0, 10) : null;
}

function pickNoticeReport(rows: readonly Report[], prior: string, remitDue: string | null): Report | null {
  const filed = rows.filter((r) => r.stage === prior && isReportLocked(r.status));
  return filed.find((r) => remitDue !== null && parseFilingRecord(r.filingRecord)?.nextStage?.due?.date === remitDue) ?? filed[0] ?? null;
}

function pickStageReport(rows: readonly Report[], stage: string, notice: Report | null, remitDue: string | null): Report | null {
  const after = rows.filter((r) => r.stage === stage && (!notice || r.createdAt >= notice.createdAt));
  for (const r of after) {
    if (!isReportLocked(r.status)) return r;
    const frozen = parseFilingRecord(r.filingRecord)?.remitDue?.date ?? null;
    if (frozen === null || remitDue === null || frozen === remitDue) return r;
  }
  return null;
}

/**
 * The state's pending follow-up (remit) stage, or null when nothing waits on one. Items are `reported`, filed under a
 * notice-only stage, not yet remitted; the earliest remit date is the cohort.
 */
export async function loadRemitStage(db: Db, companyId: string, state: string, asOf: string): Promise<RemitStage | null> {
  const rules = tryLoadRules(state)?.file ?? null;
  if (!rules || !followUpStageOf(rules, null)) return null;
  const rows = await db
    .select()
    .from(staleItems)
    .where(and(eq(staleItems.companyId, companyId), eq(staleItems.ownerState, state), eq(staleItems.status, "reported")))
    .orderBy(asc(staleItems.createdAt), asc(staleItems.id));
  const waiting = rows.filter((r) => followUpStageOf(rules, r.reportStage) !== null);
  if (waiting.length === 0) return null;
  const stage = followUpStageOf(rules, waiting[0]!.reportStage)!;
  const due = minDate(waiting.map((r) => r.remitDueDate));
  // One cohort at a time: the earliest remit date (items with no engine date join the cohort only when none has one).
  const items = waiting.filter((r) => r.remitDueDate === due);
  const reportRows = await db
    .select()
    .from(reports)
    .where(and(eq(reports.companyId, companyId), eq(reports.state, state)))
    .orderBy(desc(reports.createdAt));
  const noticeReport = pickNoticeReport(reportRows, stage.prior, due);
  const report = pickStageReport(reportRows, stage.name, noticeReport, due);
  const opensOn = due && isIsoDate(due) ? addDays(due, -REMIT_STAGE_OPENS_DAYS_BEFORE) : null;
  return {
    state,
    stage,
    items,
    count: items.length,
    totalCents: items.reduce((a, r) => a + r.amountCents, 0),
    remitDue: due ? { date: due, unverified: items.some((r) => r.dependsOnUnverified) || !stage.verified } : null,
    opensOn,
    open: report !== null || opensOn === null || asOf >= opensOn,
    noticeReport,
    noticeFiledOn: noticeReport ? filedOn(noticeReport) : null,
    report,
  };
}

/** The latest remit-stage report of the state that is filed and fully remitted (for the "previous stage" receipt). */
export async function loadClosedRemitReport(db: Db, companyId: string, state: string): Promise<Report | null> {
  const rules = tryLoadRules(state)?.file ?? null;
  const stage = followUpStageOf(rules, null);
  if (!stage) return null;
  const [row] = await db
    .select()
    .from(reports)
    .where(and(eq(reports.companyId, companyId), eq(reports.state, state), eq(reports.stage, stage.name)))
    .orderBy(desc(reports.createdAt))
    .limit(1);
  return row && isReportLocked(row.status) ? row : null;
}
