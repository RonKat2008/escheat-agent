/**
 * Loads the facts for the close-out runner page (company-scoped, read-only) and derives the runner in code. The plan
 * comes from the same snapshot as the chat card; the runner adds what its buttons need (each letter's payee, amount
 * and draft hash, the report's checksum, the filing run, the send mode, the remittance) and the late-money interest
 * from the shared helper. Nothing here writes.
 */
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { approvals, ledgerItems, outreach, staleItems } from "@/db/schema";
import { getEnv, hasLob, isOffline } from "@/lib/env";
import { composeStateOf } from "@/lib/outreach/bulk";
import { outreachContentSha256 } from "@/lib/outreach/util";
import { getOverdue } from "@/lib/queries";
import { summarizeLateMoney } from "@/lib/reports/late-money";
import { listReportSummaries } from "@/lib/reports/service";
import type { ValidationError } from "@/lib/reports/validate";
import { summarizeValidation } from "@/lib/reports/validation-summary";
import { tryLoadRules } from "@/lib/rules/load";
import { deriveClosePlan } from "./derive";
import { loadCloseSnapshot } from "./plan";
import { loadRemittance } from "./remittance";
import {
  daysBetween,
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
    .where(and(eq(staleItems.companyId, companyId), eq(staleItems.ownerState, state), inArray(staleItems.status, ["dd_pending", "dd_sent"])));
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

async function loadReport(db: Db, companyId: string, state: string): Promise<RunnerReport | null> {
  const latest = (await listReportSummaries(db, companyId)).find((s) => s.state === state)?.latest ?? null;
  if (!latest) return null;
  const [approval] = latest.approvalId
    ? await db.select({ approvedBy: approvals.approvedBy }).from(approvals).where(eq(approvals.id, latest.approvalId))
    : [];
  const { errorCount, warningCount } = summarizeValidation(((latest.validationErrors ?? []) as ValidationError[]).filter(Boolean));
  return {
    id: latest.id,
    status: latest.status,
    checksum: latest.checksum,
    itemCount: latest.itemCount,
    totalCents: latest.totalCents,
    errorCount,
    warningCount,
    confirmation: latest.replicaConfirmation,
    submittedAt: latest.submittedAt?.toISOString() ?? null,
    approvedBy: approval?.approvedBy ?? null,
  };
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
  const [letters, report, overdue] = await Promise.all([loadLetters(db, companyId, st), loadReport(db, companyId, st), getOverdue(db, companyId, { states: [st] })]);
  const remittance = report ? await loadRemittance(db, companyId, st, report.id) : null;

  // The report's items: To Report before filing, reported after. Their engine dates (never recomputed here).
  const filed = snap.items.filter((i) => i.status === "to_report" || i.status === "reported");
  const due = filed.map((i) => i.reportDueDate).filter((d): d is string => !!d).sort()[0] ?? null;
  const remitDue = filed.map((i) => i.remitDueDate).filter((d): d is string => !!d).sort()[0] ?? null;
  const daysLate = due && due < snap.asOf ? daysBetween(due, snap.asOf) : null;
  const late = summarizeLateMoney(overdue.items, (s) => tryLoadRules(s)?.file ?? null, overdue.asOf).byState.find((b) => b.state === st);
  const reported = snap.items.filter((i) => i.status === "reported");

  return {
    plan,
    letters: letters.open,
    sent: letters.sent,
    report,
    run: snap.filingRun ? { id: snap.filingRun.id, status: snap.filingRun.status, phase: snap.filingRun.phase, error: snap.filingRun.error } : null,
    late: {
      reportDue: due,
      reportDueUnverified: filed.some((i) => i.dependsOnUnverified),
      daysLate,
      interest: late?.interest ?? { status: "none" },
      remitDue,
    },
    ddItemCount: snap.items.filter((i) => i.status === "dd_pending" || i.status === "dd_sent").length,
    sendMode: currentSendMode(),
    unverifiedRuleCount: snap.unverifiedRulePaths.length,
    remitOwed: { count: reported.length, totalCents: reported.reduce((a, i) => a + i.amountCents, 0) },
    remittance,
  };
}

/** The runner for one state, built in code from the company's records. Read-only and idempotent. */
export async function buildRunner(db: Db, companyId: string, state: string): Promise<RunnerView> {
  return deriveRunner(await loadRunnerFacts(db, companyId, state));
}

