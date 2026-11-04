/**
 * Loads the facts for the close-out runner page (company-scoped, read-only) and derives the runner in code. The plan
 * comes from the same snapshot as the chat card; the runner adds what its buttons need (each letter's payee, amount
 * and draft hash, the report's checksum, the filing run, the send mode, the remittance) and the late-money interest
 * from the shared helper. Nothing here writes.
 */
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { approvals, ledgerItems, outreach, reports, staleItems } from "@/db/schema";
import { approverName } from "@/lib/auth/approver";
import { getEnv, hasLob, isOffline } from "@/lib/env";
import { composeStateOf } from "@/lib/outreach/bulk";
import { outreachContentSha256 } from "@/lib/outreach/util";
import { nextStageOf, parseFilingRecord, type FilingRecord } from "@/lib/reports/filing-record";
import type { ValidationError } from "@/lib/reports/validate";
import { summarizeValidation } from "@/lib/reports/validation-summary";
import { tryLoadRules } from "@/lib/rules/load";
import { listRuleValues } from "@/lib/rules/values";
import { deriveClosePlan, type CloseSnapshot } from "./derive";
import { loadCycleLate, loadUnsentNotices, reportItemsOf } from "./filing-record";
import { loadCloseSnapshot } from "./plan";
import { filedOn, loadClosedRemitReport } from "./remit-stage";
import { loadRemittance } from "./remittance";
import {
  deriveRunner,
  type RunnerFacts,
  type RunnerLetter,
  type RunnerReport,
  type RunnerSentLetter,
  type RunnerView,
  type SendMode,
} from "./runner-model";

const LETTER_STATUSES = ["draft", "awaiting_approval", "approved"] as const;
const SENT_STATUSES = ["sent", "delivered", "responded"] as const;

interface LetterRows {
  open: RunnerLetter[];
  sent: RunnerSentLetter[];
}

async function loadLetters(db: Db, companyId: string, state: string): Promise<LetterRows> {
  const items = await db
    .select({ id: staleItems.id, status: staleItems.status })
    .from(staleItems)
    // Every item of the state: a sent letter stays listed even after status-events (R5-09) moved its item past
    // dd_sent (to_report once the window closed). Only dd_pending items carry open drafts.
    .where(and(eq(staleItems.companyId, companyId), eq(staleItems.ownerState, state)));
  if (items.length === 0) return { open: [], sent: [] };
  const rows = await db
    .select({ o: outreach, payeeName: ledgerItems.payeeNameRaw, checkNumber: ledgerItems.referenceNumber, amountCents: staleItems.amountCents })
    .from(outreach)
    .innerJoin(staleItems, eq(staleItems.id, outreach.staleItemId))
    .innerJoin(ledgerItems, eq(ledgerItems.id, staleItems.ledgerItemId))
    .where(
      and(
        eq(outreach.companyId, companyId),
        eq(outreach.channel, "letter"),
        inArray(outreach.status, [...LETTER_STATUSES, ...SENT_STATUSES]),
        inArray(outreach.staleItemId, items.map((i) => i.id)),
      ),
    )
    .orderBy(outreach.createdAt, outreach.id);
  const pending = new Set(items.filter((i) => i.status === "dd_pending").map((i) => i.id));
  const open: RunnerLetter[] = [];
  const sent: RunnerSentLetter[] = [];
  for (const { o, payeeName, checkNumber, amountCents } of rows) {
    if ((SENT_STATUSES as readonly string[]).includes(o.status)) {
      sent.push({ outreachId: o.id, payeeName, amountCents, offline: Boolean(o.offline) });
      continue;
    }
    if (!pending.has(o.staleItemId)) continue;
    const c = composeStateOf(o);
    open.push({
      outreachId: o.id,
      staleItemId: o.staleItemId,
      status: o.status as RunnerLetter["status"],
      composed: c.composed,
      ready: c.ready,
      problems: c.problems,
      contentSha256: outreachContentSha256(o),
      payeeName,
      checkNumber,
      amountCents,
    });
  }
  return { open, sent };
}

/** The snapshot's report (the cycle's, or the remit stage's once that is open), with what the runner prints from it. */
async function loadReport(db: Db, reportId: string | null): Promise<{ view: RunnerReport; record: FilingRecord | null; stage: string | null } | null> {
  if (!reportId) return null;
  const [latest] = await db.select().from(reports).where(eq(reports.id, reportId));
  if (!latest) return null;
  const [approval] = latest.approvalId
    ? await db.select({ approvedBy: approvals.approvedBy }).from(approvals).where(eq(approvals.id, latest.approvalId))
    : [];
  const { errorCount, warningCount } = summarizeValidation(((latest.validationErrors ?? []) as ValidationError[]).filter(Boolean));
  const view: RunnerReport = {
    id: latest.id,
    status: latest.status,
    checksum: latest.checksum,
    itemCount: latest.itemCount,
    totalCents: latest.totalCents,
    errorCount,
    warningCount,
    confirmation: latest.replicaConfirmation,
    submittedAt: latest.submittedAt?.toISOString() ?? null,
    approvedBy: approverName(approval?.approvedBy),
  };
  return { view, record: parseFilingRecord(latest.filingRecord), stage: latest.stage };
}

/** How a send would really go right now (R5-03): the label and the message follow the server's real mode. */
export function currentSendMode(env = getEnv()): SendMode {
  if (isOffline(env)) return "offline";
  return hasLob(env) ? "lob_test" : "not_configured";
}

export async function loadRunnerFacts(db: Db, companyId: string, stateInput: string): Promise<RunnerFacts> {
  const snap = await loadCloseSnapshot(db, companyId, stateInput);
  const plan = deriveClosePlan(snap);
  const st = snap.state;
  const [letters, loaded, late, prior] = await Promise.all([
    loadLetters(db, companyId, st),
    loadReport(db, snap.report?.id ?? null),
    loadCycleLate(db, companyId, snap),
    loadPriorStage(db, companyId, snap),
  ]);
  const report = loaded?.view ?? null;
  const record = loaded?.record ?? null;
  const remittance = report ? await loadRemittance(db, companyId, st, report.id) : null;
  const reported = snap.items.filter((i) => i.status === "reported");
  // R6-09: before approval the never-sent notices are live; once approved they are the frozen record's.
  const unsent = record ? record.unsentNotices : await loadUnsentNotices(db, companyId, reportItemsOf(snap));
  const rules = tryLoadRules(st)?.file ?? null;
  const values = rules ? listRuleValues(rules) : [];
  const facts = snap.report ? { remits: snap.report.stageRemits ?? null } : null;
  const remitDue = late.remitDue ? { date: late.remitDue, unverified: late.remitDueUnverified } : null;

  return {
    plan,
    letters: letters.open,
    sent: letters.sent,
    report,
    run: snap.filingRun ? { id: snap.filingRun.id, status: snap.filingRun.status, phase: snap.filingRun.phase, error: snap.filingRun.error } : null,
    late: {
      reportDue: late.reportDue,
      reportDueUnverified: late.reportDueUnverified,
      daysLate: late.daysLate,
      interest: late.interest,
      remitDue: late.remitDue,
    },
    record,
    unsent,
    ruleTotals: rules ? { verified: values.filter((v) => v.rv.verified).length, total: values.length } : null,
    cycleItemCount: snap.items.length,
    stage: facts ? { remits: facts.remits, next: record?.nextStage ?? (facts.remits === false ? nextStageOf(rules, loaded?.stage ?? null, remitDue) : null) } : null,
    ddItemCount: snap.items.filter((i) => i.status === "dd_pending" || i.status === "dd_sent").length,
    sendMode: currentSendMode(),
    unverifiedRuleCount: snap.unverifiedRulePaths.length,
    remitOwed: { count: reported.length, totalCents: reported.reduce((a, i) => a + i.amountCents, 0) },
    remittance,
    followUp: snap.followUp ?? null,
    // The locked notice report's own remit step already shows the schedule; elsewhere it is its own scheduled line.
    scheduled: snap.scheduled && snap.report?.id !== snap.scheduled.noticeReportId ? snap.scheduled : null,
    prior,
  };
}

/**
 * R7-01: after the remit stage is filed and remitted the runner moves on to the next notice cycle; until that cycle
 * has a report of its own, the remit stage's receipt stays on the page (this clock year only).
 */
async function loadPriorStage(db: Db, companyId: string, snap: CloseSnapshot): Promise<RunnerFacts["prior"]> {
  if (snap.followUp || snap.scheduled || snap.report) return null;
  const closed = await loadClosedRemitReport(db, companyId, snap.state);
  if (!closed || (filedOn(closed) ?? "").slice(0, 4) !== snap.asOf.slice(0, 4)) return null;
  const [loaded, remittance] = await Promise.all([loadReport(db, closed.id), loadRemittance(db, companyId, snap.state, closed.id)]);
  if (!loaded || !remittance) return null;
  return { report: loaded.view, record: loaded.record, remittance };
}

/** The runner for one state, built in code from the company's records. Read-only and idempotent. */
export async function buildRunner(db: Db, companyId: string, state: string): Promise<RunnerView> {
  return deriveRunner(await loadRunnerFacts(db, companyId, state));
}

