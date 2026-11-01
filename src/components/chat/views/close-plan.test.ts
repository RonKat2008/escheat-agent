import { describe, expect, it } from "vitest";
import type { ClosePlan, CloseStepStatus } from "@/lib/chat/ui-types";
import { changedSteps } from "./close-plan";

const plan = (statuses: CloseStepStatus[]): ClosePlan =>
  ({ steps: (["letters_draft", "letters_approve", "letters_send"] as const).map((id, i) => ({ id, status: statuses[i]! })) }) as unknown as ClosePlan;

describe("changedSteps", () => {
  it("is empty on first render and lists only steps whose status moved", () => {
    const a = plan(["ready", "blocked", "blocked"]);
    const b = plan(["done", "needs_approval", "blocked"]);
    expect(changedSteps(null, a).size).toBe(0);
    expect([...changedSteps(a, b)]).toEqual(["letters_draft", "letters_approve"]);
    expect(changedSteps(b, b).size).toBe(0);
  });
});
