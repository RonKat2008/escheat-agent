/**
 * Chat's close-out card counts exactly like the close-out runner (dogfood R6-04): "N of M steps done · K not needed".
 * The plan's steps come from the same records; the counts, the not-needed and missed marks, the late marks and the
 * headline due date come from the runner model's own `deriveRunner`, so the card and /close-out/<STATE> can never
 * disagree (R7-02).
 */
import type { Db } from "@/db/client";
import { loadRunnerFacts } from "@/lib/close-out/runner";
import { deriveRunner, type RunnerLate, type RunnerStep, type RunnerView } from "@/lib/close-out/runner-model";
import type { ClosePlan, CloseStepId } from "./ui-types";

const REPORT_STEPS = new Set<CloseStepId>(["report_generate", "report_approve", "report_submit"]);
const settled = (s: RunnerStep) => s.tone === "done" || s.tone === "not_needed" || s.tone === "missed";
const worstLate = (steps: readonly RunnerStep[]) => steps.map((s) => s.late?.daysLate ?? null).filter((d): d is number => d !== null).sort((a, b) => b - a)[0] ?? null;

type RunnerCounts = Pick<RunnerView, "steps" | "done" | "total" | "notNeeded">;
type LateFacts = Pick<RunnerLate, "reportDue" | "reportDueUnverified" | "remitDue">;

/** The deadline the runner is working to: the report's while a report step is open, else the remittance's. */
export function nextDueOf(plan: ClosePlan, runner: RunnerCounts, late?: LateFacts | null): ClosePlan["nextDue"] {
  const report = runner.steps.filter((s) => REPORT_STEPS.has(s.id));
  if (report.some((s) => !settled(s))) {
    const date = late?.reportDue ?? plan.reportDue?.date ?? null;
    return { label: "Report due", date, unverified: late ? late.reportDueUnverified : Boolean(plan.reportDue?.unverified), daysLate: worstLate(report) };
  }
  const remit = runner.steps.find((s) => s.id === "remit");
  if (remit && !settled(remit)) {
    const date = late?.remitDue ?? plan.remitDue?.date ?? null;
    return { label: "Remit due", date, unverified: Boolean(plan.remitDue?.unverified) || remit.unverified, daysLate: remit.late?.daysLate ?? null };
  }
  return null;
}

/** Folds the runner's verdict into the plan: not-needed and missed steps, late marks, counts and the next due date. */
export function withRunnerCounts(plan: ClosePlan, runner: RunnerCounts, late?: LateFacts | null): ClosePlan {
  const byId = new Map(runner.steps.map((s) => [s.id, s]));
  return {
    ...plan,
    done: runner.done,
    total: runner.total,
    notNeeded: runner.notNeeded,
    nextDue: nextDueOf(plan, runner, late),
    steps: plan.steps.map((s) => {
      const r = byId.get(s.id);
      if (!r) return s;
      if (r.tone === "not_needed") return { ...s, notNeeded: true, detail: r.detail, amountCents: null, count: null, action: null };
      // R7-02: a required notice that never went out is pink "Not sent" on the card too, never "Done".
      if (r.tone === "missed") return { ...s, missed: true, detail: r.detail, amountCents: r.amountCents, count: r.count, action: null };
      return r.late ? { ...s, late: r.late } : s;
    }),
  };
}

/** The close-out plan for chat (tool, Refresh and step buttons), with the runner's counts. Read-only. */
export async function buildChatClosePlan(db: Db, companyId: string, state: string): Promise<ClosePlan> {
  const facts = await loadRunnerFacts(db, companyId, state);
  return withRunnerCounts(facts.plan, deriveRunner(facts), facts.late);
}
