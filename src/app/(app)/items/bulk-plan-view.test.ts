import { describe, expect, it } from "vitest";
import type { PlanEntry } from "@/lib/outreach/bulk-plan";
import { chunk, confirmLabel, groupPlan, previewTitle } from "./bulk-plan-view";

const rows = new Map([
  ["a", { payeeName: "Ann", checkNumber: "1" }],
  ["b", { payeeName: "Bo", checkNumber: null }],
  ["c", { payeeName: "Cy", checkNumber: "3" }],
  ["d", { payeeName: "Di", checkNumber: "4" }],
]);

const plan: PlanEntry[] = [
  { staleItemId: "a", decision: "will_draft" },
  { staleItemId: "b", decision: "skip", code: "window_not_open", message: "Opens May 2, 2030", detail: { opensOn: "2030-05-02" } },
  { staleItemId: "c", decision: "skip", code: "rule_unknown", message: "TX notice language is UNKNOWN", detail: { rule: "dueDiligence.requiredLanguage", state: "TX" } },
  { staleItemId: "d", decision: "skip", code: "rule_unknown", message: "TX notice language is UNKNOWN", detail: {} },
  { staleItemId: "zz", decision: "skip", code: "not_found", message: "Not found", detail: {} },
];

describe("groupPlan", () => {
  it("summarises will-draft vs skipped and groups skips by reason, largest group first", () => {
    const p = groupPlan(plan, rows);
    expect(p.title).toBe("1 will be drafted, 4 skipped");
    expect(p.willDraft).toEqual(["a"]);
    expect(p.groups.map((g) => [g.code, g.entries.length])).toEqual([
      ["rule_unknown", 2],
      ["window_not_open", 1],
      ["not_found", 1],
    ]);
    expect(p.groups[0]!.label).toBe("A required rule value is unknown");
  });

  it("keeps the server's message per item and names unknown ids honestly", () => {
    const p = groupPlan(plan, rows);
    const win = p.groups.find((g) => g.code === "window_not_open")!;
    expect(win.entries[0]).toMatchObject({ payeeName: "Bo", message: "Opens May 2, 2030", checkNumber: null });
    expect(p.groups.find((g) => g.code === "not_found")!.entries[0]!.payeeName).toBe("Unknown item");
  });

  it("handles an all-draft plan and an empty plan", () => {
    expect(groupPlan([{ staleItemId: "a", decision: "will_draft" }], rows)).toMatchObject({ skipped: 0, groups: [], title: "1 will be drafted, 0 skipped" });
    expect(groupPlan([], rows).title).toBe(previewTitle(0, 0));
  });
});

describe("helpers", () => {
  it("labels the confirm button and chunks ids for the 50-per-call limit", () => {
    expect(confirmLabel(1)).toBe("Draft 1 letter");
    expect(confirmLabel(12)).toBe("Draft 12 letters");
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 50)).toEqual([]);
  });
});
