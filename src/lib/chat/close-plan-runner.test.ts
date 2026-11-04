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

const basePlan = (over: Partial<ClosePlan> = {}): ClosePlan => ({
  state: "DE",
  stateName: "Delaware",
  asOf: "2029-03-30",
  ruleVersion: "de@1",
  steps: IDS.map((id) => step(id, "done")),
  done: 7,
  total: 8,
  nextStepId: "remit",
  atStakeCents: 280_633,
  itemCount: 1,
  reportDue: null,
  remitDue: { date: "2029-03-01", unverified: true },
  ...over,
});
const rs = (id: CloseStepId, tone: RunnerStep["tone"], over: Partial<RunnerStep> = {}): RunnerStep =>
  ({ id, title: id, tone, detail: `runner ${id}`, amountCents: null, count: null, unverified: false, control: null, fix: null, late: null, ...over }) as RunnerStep;

describe("chat close-out card follows the runner's missed and late states (R7-02)", () => {
  it("a required notice that was never sent is 'missed' on the card (pink Not sent), never Done", () => {
    const steps = IDS.map((id) =>
      id === "letters_send"
        ? rs(id, "missed", { detail: "Not sent. 1 required due-diligence notice ... Zinnia Court Market ($2,806.33)", amountCents: 280_633, count: 1 })
        : id.startsWith("letters")
          ? rs(id, "missed", { detail: "Not sent: the due-diligence window closed before the letter went out (see Send the letters)." })
          : rs(id, id === "remit" ? "human" : "done"),
    );
    const out = withRunnerCounts(basePlan(), { steps, done: 4, total: 8, notNeeded: 0 });
    const send = out.steps.find((s) => s.id === "letters_send")!;
    expect(send).toMatchObject({ missed: true, detail: expect.stringMatching(/^Not sent\./), amountCents: 280_633, count: 1, action: null });
    expect(out.steps.filter((s) => s.missed).map((s) => s.id)).toEqual(["letters_draft", "letters_approve", "letters_send"]);
    expect(out.steps.some((s) => s.missed && s.notNeeded)).toBe(false);
  });

  it("a late remittance is the card's headline date with its days late, never 'Nothing due'", () => {
    const steps = IDS.map((id) => (id === "remit" ? rs(id, "human", { late: { date: "2029-03-01", daysLate: 29 }, unverified: true }) : rs(id, "done")));
    const out = withRunnerCounts(basePlan(), { steps, done: 7, total: 8, notNeeded: 0 }, { reportDue: "2028-03-01", reportDueUnverified: true, remitDue: "2029-03-01" });
    expect(out.nextDue).toEqual({ label: "Remit due", date: "2029-03-01", unverified: true, daysLate: 29 });
    expect(out.steps.find((s) => s.id === "remit")?.late).toEqual({ date: "2029-03-01", daysLate: 29 });
  });

  it("while a report step is open the headline is the report's date; with nothing open it is null", () => {
    const open = IDS.map((id) => (id === "report_generate" ? rs(id, "machine", { late: { date: "2026-07-01", daysLate: 123 } }) : rs(id, id === "remit" ? "blocked" : "done")));
    const late = { reportDue: "2026-07-01", reportDueUnverified: true, remitDue: "2026-07-01" };
    expect(withRunnerCounts(basePlan(), { steps: open, done: 6, total: 8, notNeeded: 0 }, late).nextDue).toEqual({ label: "Report due", date: "2026-07-01", unverified: true, daysLate: 123 });
    const closed = IDS.map((id) => rs(id, id.startsWith("letters") ? "not_needed" : "done"));
    expect(withRunnerCounts(basePlan(), { steps: closed, done: 5, total: 5, notNeeded: 3 }, late).nextDue).toBeNull();
  });
});
