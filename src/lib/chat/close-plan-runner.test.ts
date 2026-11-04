import { describe, expect, it } from "vitest";
import type { RunnerStep } from "@/lib/close-out/runner-model";
import { withRunnerCounts } from "./close-plan-runner";
import type { ClosePlan, CloseStep, CloseStepId } from "./ui-types";

const step = (id: CloseStepId, status: CloseStep["status"]): CloseStep => ({
  id,
  title: id,
  status,
  detail: `plan detail ${id}`,
  blockedReason: null,
  amountCents: status === "done" ? 0 : 77374,
  count: 1,
  href: "/x",
  linkLabel: "Open",
  action: null,
  unverified: false,
});

const IDS: CloseStepId[] = ["letters_draft", "letters_approve", "letters_send", "rules_verify", "report_generate", "report_approve", "report_submit", "remit"];

describe("chat close-out card counts like the runner (R6-04)", () => {
  it("not-needed letter steps are marked, carry the runner's reason, and leave done/total", () => {
    const plan: ClosePlan = {
      state: "TX",
      stateName: "Texas",
      asOf: "2026-11-01",
      ruleVersion: "tx@1",
      steps: IDS.map((id, i) => step(id, i < 3 ? "done" : "ready")),
      done: 3,
      total: 8,
      nextStepId: "rules_verify",
      atStakeCents: 77374,
      itemCount: 1,
      reportDue: null,
      remitDue: null,
    };
    const runnerSteps = IDS.map((id, i) => ({ id, tone: i < 3 ? "not_needed" : "human", detail: i < 3 ? "Not needed this cycle: no TX item is inside its due-diligence window, so no letter is due." : "x" })) as RunnerStep[];
    const out = withRunnerCounts(plan, { steps: runnerSteps, done: 0, total: 5, notNeeded: 3 });
    expect([out.done, out.total, out.notNeeded]).toEqual([0, 5, 3]);
    expect(out.steps.filter((s) => s.notNeeded).map((s) => s.id)).toEqual(["letters_draft", "letters_approve", "letters_send"]);
    expect(out.steps[0]!.detail).toMatch(/^Not needed this cycle/);
    expect(out.steps[0]!.amountCents).toBeNull();
    expect(out.steps[3]).toEqual(plan.steps[3]);
    // Pure: the input plan is not changed.
    expect(plan.done).toBe(3);
    expect(plan.steps[0]!.notNeeded).toBeUndefined();
  });
});
