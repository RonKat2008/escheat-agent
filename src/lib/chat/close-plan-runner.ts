/**
 * Chat's close-out card counts exactly like the close-out runner (dogfood R6-04): "N of M steps done · K not needed".
 * The plan's steps come from the same records; the counts and the not-needed marks come from the runner model's own
 * `deriveRunner`, so the card and /close-out/<STATE> can never disagree.
 */
import type { Db } from "@/db/client";
import { loadRunnerFacts } from "@/lib/close-out/runner";
import { deriveRunner, type RunnerView } from "@/lib/close-out/runner-model";
import type { ClosePlan } from "./ui-types";

/** Folds the runner's verdict into the plan: not-needed steps are marked and leave the done/total counts. */
export function withRunnerCounts(plan: ClosePlan, runner: Pick<RunnerView, "steps" | "done" | "total" | "notNeeded">): ClosePlan {
  const skipped = new Map(runner.steps.filter((s) => s.tone === "not_needed").map((s) => [s.id, s.detail]));
  return {
    ...plan,
    done: runner.done,
    total: runner.total,
    notNeeded: runner.notNeeded,
    steps: plan.steps.map((s) => {
      const detail = skipped.get(s.id);
      return detail === undefined ? s : { ...s, notNeeded: true, detail, amountCents: null, count: null, action: null };
    }),
  };
}

/** The close-out plan for chat (tool, Refresh and step buttons), with the runner's counts. Read-only. */
export async function buildChatClosePlan(db: Db, companyId: string, state: string): Promise<ClosePlan> {
  const facts = await loadRunnerFacts(db, companyId, state);
  return withRunnerCounts(facts.plan, deriveRunner(facts));
}
