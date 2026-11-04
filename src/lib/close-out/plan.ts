/**
 * Loads the snapshot for one state's close-out plan (company-scoped, read-only) and derives the plan in code.
 * Nothing here writes, approves, sends or files. Dates come from the engine-computed columns on stale_items.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { agentRuns, outreach, ruleChanges, staleItems, type Outreach, type Report } from "@/db/schema";
import { parseFilingRecord, stageOf } from "@/lib/reports/filing-record";
import { FILING_AGENT } from "@/lib/browser-agents/runs";
import * as clock from "@/lib/clock";
import type { ClosePlan } from "@/lib/chat/ui-types";
import { draftIneligibleReason } from "@/lib/outreach/bulk";
import { listReportSummaries } from "@/lib/reports/service";
import { tryLoadRules } from "@/lib/rules/load";
import { listRuleValuesFor } from "@/lib/rules/values";
import type { RuleFile, RulePropertyType } from "../../../rules/schema";
import { deriveClosePlan, isCloseOutState, type CloseOutState, type CloseSnapshot, type LetterState, type SnapshotItem } from "./derive";

export class ClosePlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClosePlanError";
  }
}

const OPEN_CYCLE = ["dd_pending", "dd_sent", "owner_responded", "to_report"] as const;
/** Once the cycle's report is submitted: reported items not yet remitted are what is left to pay. */
const FILED_CYCLE = ["reported"] as const;
const LOCKED = new Set(["submitted", "confirmed"]);

type LetterRow = Pick<Outreach, "staleItemId" | "status" | "tracking">;

/** The most advanced letter on file. Cancelled and failed letters do not count. */
export function letterState(rows: readonly Pick<Outreach, "status">[]): LetterState {
  const live = rows.map((r) => r.status);
  if (live.some((s) => s === "sent" || s === "delivered" || s === "responded")) return "sent";
  if (live.includes("approved")) return "approved";
  if (live.some((s) => s === "draft" || s === "awaiting_approval")) return "draft";
  return "none";
}

function hasReadinessProblems(rows: readonly LetterRow[]): boolean {
  return rows.some((r) => {
    if (r.status !== "draft" && r.status !== "awaiting_approval") return false;
    const ready = (r.tracking?.compose as { readiness?: { ready?: boolean } } | undefined)?.readiness?.ready;
    return ready === false;
  });
}

/** R6-02: the report's stage from its frozen record (else the rule file), and the stage after it. */
export function stageFacts(
  rules: RuleFile | null,
  report: Pick<Report, "stage" | "filingRecord">,
): { stageRemits: boolean | null; nextStageName: string | null; nextStageVerified: boolean } {
  const frozen = parseFilingRecord(report.filingRecord);
  const s = stageOf(rules, report.stage);
  const next = rules && s.index >= 0 ? rules.reportStages[s.index + 1] : undefined;
  return {
    stageRemits: frozen?.stageRemits ?? s.remits,
    nextStageName: frozen?.nextStage?.name ?? next?.name ?? null,
    nextStageVerified: next ? Boolean(next.dueRule.verified) : false,
  };
}

export function parseCloseOutState(input: string): CloseOutState {
  const st = input.trim().toUpperCase();
  if (!isCloseOutState(st)) throw new ClosePlanError(`Close-out plans cover CA, DE and TX only, not "${input}".`);
  return st;
}

export async function loadCloseSnapshot(db: Db, companyId: string, stateInput: string): Promise<CloseSnapshot> {
  const state = parseCloseOutState(stateInput);
  const asOf = await clock.now(db, companyId);
  const summary = (await listReportSummaries(db, companyId)).find((s) => s.state === state);
  const latest = summary?.latest ?? null;
  const locked = !!latest && LOCKED.has(latest.status);

  const statuses = locked ? [...OPEN_CYCLE, ...FILED_CYCLE] : [...OPEN_CYCLE];
  const rows = await db
    .select()
    .from(staleItems)
    .where(and(eq(staleItems.companyId, companyId), eq(staleItems.ownerState, state), inArray(staleItems.status, statuses)))
    .orderBy(staleItems.createdAt, staleItems.id);

  const letters: LetterRow[] = rows.length
    ? await db
        .select({ staleItemId: outreach.staleItemId, status: outreach.status, tracking: outreach.tracking })
        .from(outreach)
        .where(and(eq(outreach.companyId, companyId), eq(outreach.channel, "letter"), inArray(outreach.staleItemId, rows.map((r) => r.id))))
    : [];
  const byItem = new Map<string, LetterRow[]>();
  for (const l of letters) byItem.set(l.staleItemId, [...(byItem.get(l.staleItemId) ?? []), l]);

  const items: SnapshotItem[] = rows.map((r) => {
    const mine = byItem.get(r.id) ?? [];
    return {
      id: r.id,
      status: r.status as SnapshotItem["status"],
      amountCents: r.amountCents,
      dependsOnUnverified: r.dependsOnUnverified,
      ddWindowEnd: r.ddWindowEnd,
      reportDueDate: r.reportDueDate,
      remitDueDate: r.remitDueDate,
      letter: letterState(mine),
      draftable: r.status === "dd_pending" && draftIneligibleReason(r, mine, "letter") === null,
      draftHasProblems: hasReadinessProblems(mine),
    };
  });

  const rules = tryLoadRules(state);
  const types = [...new Set(rows.map((r) => r.propertyType))] as RulePropertyType[];
  const unverified = rules
    ? [...new Set(types.flatMap((pt) => listRuleValuesFor(rules.file, pt).filter((v) => !v.rv.verified).map((v) => v.path)))].sort()
    : [];
  const [pending] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(ruleChanges)
    .where(and(eq(ruleChanges.state, state), eq(ruleChanges.status, "proposed")));

  const [run] = latest
    ? await db
        .select({ id: agentRuns.id, status: agentRuns.status, output: agentRuns.output, error: agentRuns.error })
        .from(agentRuns)
        .where(and(eq(agentRuns.companyId, companyId), eq(agentRuns.agent, FILING_AGENT), sql`${agentRuns.input}->>'reportId' = ${latest.id}`))
        .orderBy(desc(agentRuns.startedAt))
        .limit(1)
    : [];

  return {
    state,
    asOf,
    ruleVersion: rules?.file.version ?? null,
    hasRules: !!rules,
    unverifiedRulePaths: unverified,
    pendingRuleChanges: pending?.n ?? 0,
    items,
    toReport: { count: summary?.toReportCount ?? 0, cents: summary?.toReportCents ?? 0 },
    report: latest
      ? {
          id: latest.id,
          status: latest.status,
          itemCount: latest.itemCount,
          totalCents: latest.totalCents,
          errorCount: (latest.validationErrors ?? []).filter((e) => (e as { severity?: string } | null)?.severity === "error").length,
          confirmation: latest.replicaConfirmation,
          ...stageFacts(rules?.file ?? null, latest),
        }
      : null,
    filingRun: run
      ? { id: run.id, status: run.status, phase: typeof run.output?.phase === "string" ? run.output.phase : null, error: run.error }
      : null,
  };
}

/** The close-out plan for one state, built in code from the company's records. Read-only and idempotent. */
export async function buildClosePlan(db: Db, companyId: string, state: string): Promise<ClosePlan> {
  return deriveClosePlan(await loadCloseSnapshot(db, companyId, state));
}
