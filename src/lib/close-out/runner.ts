/**
 * Loads the facts for the close-out runner page (company-scoped, read-only) and derives the runner in code. The plan
 * comes from the same snapshot as the chat card; the runner adds what its buttons need (draft hashes, the report's
 * checksum, the filing run) and the late-money interest from the shared helper. Nothing here writes.
 */
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { approvals, outreach, staleItems } from "@/db/schema";
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
import { daysBetween, deriveRunner, type RunnerFacts, type RunnerLetter, type RunnerReport, type RunnerView } from "./runner-model";

const LETTER_STATUSES = ["draft", "awaiting_approval", "approved"] as const;

async function loadLetters(db: Db, companyId: string, state: string): Promise<RunnerLetter[]> {
  const items = await db
    .select({ id: staleItems.id })
    .from(staleItems)
    .where(and(eq(staleItems.companyId, companyId), eq(staleItems.ownerState, state), eq(staleItems.status, "dd_pending")));
  if (items.length === 0) return [];
  const rows = await db
    .select()
    .from(outreach)
    .where(
      and(
        eq(outreach.companyId, companyId),
        eq(outreach.channel, "letter"),
        inArray(outreach.status, [...LETTER_STATUSES]),
        inArray(outreach.staleItemId, items.map((i) => i.id)),
      ),
    )
    .orderBy(outreach.createdAt, outreach.id);
  return rows.map((r) => {
    const c = composeStateOf(r);
    return {
      outreachId: r.id,
      staleItemId: r.staleItemId,
      status: r.status as RunnerLetter["status"],
      composed: c.composed,
      ready: c.ready,
      problems: c.problems,
      contentSha256: outreachContentSha256(r),
    };
  });
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

export async function loadRunnerFacts(db: Db, companyId: string, stateInput: string): Promise<RunnerFacts> {
  const snap = await loadCloseSnapshot(db, companyId, stateInput);
  const plan = deriveClosePlan(snap);
  const st = snap.state;
  const [letters, report, overdue] = await Promise.all([loadLetters(db, companyId, st), loadReport(db, companyId, st), getOverdue(db, companyId, { states: [st] })]);

  // The report's items: To Report before filing, reported after. Their engine dates (never recomputed here).
  const filed = snap.items.filter((i) => i.status === "to_report" || i.status === "reported");
  const due = filed.map((i) => i.reportDueDate).filter((d): d is string => !!d).sort()[0] ?? null;
  const daysLate = due && due < snap.asOf ? daysBetween(due, snap.asOf) : null;
  const late = summarizeLateMoney(overdue.items, (s) => tryLoadRules(s)?.file ?? null, overdue.asOf).byState.find((b) => b.state === st);

  return {
    plan,
    letters,
    report,
    run: snap.filingRun ? { id: snap.filingRun.id, status: snap.filingRun.status, phase: snap.filingRun.phase, error: snap.filingRun.error } : null,
    late: {
      reportDue: due,
      reportDueUnverified: filed.some((i) => i.dependsOnUnverified),
      daysLate,
      interest: late?.interest ?? { status: "none" },
    },
  };
}

/** The runner for one state, built in code from the company's records. Read-only and idempotent. */
export async function buildRunner(db: Db, companyId: string, state: string): Promise<RunnerView> {
  return deriveRunner(await loadRunnerFacts(db, companyId, state));
}
