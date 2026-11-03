import { describe, expect, it } from "vitest";
import type { ClosePlan, CloseStepStatus } from "@/lib/chat/ui-types";
import { changedSteps, closeStepHref } from "./close-plan";

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

describe("closeStepHref", () => {
  it("adds the state and the letter kind to a bare Approvals link", () => {
    expect(closeStepHref({ id: "letters_approve", href: "/approvals" }, "ca")).toBe("/approvals?kind=letter&state=CA");
    expect(closeStepHref({ id: "letters_send", href: "/approvals" }, "TX")).toBe("/approvals?kind=letter&state=TX");
  });

  it("keeps a link that already points at one thing", () => {
    expect(closeStepHref({ id: "report_approve", href: "/approvals?sel=r%3Aabc" }, "CA")).toBe("/approvals?sel=r%3Aabc");
    expect(closeStepHref({ id: "report_submit", href: "/runs/123" }, "CA")).toBe("/runs/123");
  });

  it("keeps existing filters and adds a missing state", () => {
    expect(closeStepHref({ id: "letters_draft", href: "/items?state=DE&status=dd_pending" }, "DE")).toBe("/items?state=DE&status=dd_pending");
    expect(closeStepHref({ id: "report_generate", href: "/reports" }, "de")).toBe("/reports?state=DE");
    expect(closeStepHref({ id: "report_approve", href: "/approvals" }, "CA")).toBe("/approvals?state=CA");
  });
});
