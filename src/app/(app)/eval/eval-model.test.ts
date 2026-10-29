import { describe, expect, it } from "vitest";
import { describeMethod, errorRows, pct } from "./eval-model";

describe("eval model", () => {
  it("labels the heuristic method so it is never presented as the model", () => {
    const m = describeMethod("heuristic", "w", "o");
    expect(m.kind).toBe("heuristic");
    expect(m.detail).toMatch(/not the model/i);
    expect(describeMethod(undefined, "w", "o").kind).toBe("unknown");
    expect(describeMethod("replay (ESCHEAT_OFFLINE: cassettes only)", "w", "o").kind).toBe("replay");
  });

  it("lists only mismatched fields of failed cases", () => {
    const rows = errorRows([
      { pass: true, slice: "generated", itemSnapshot: { caseId: "g-1" }, expected: { owner_state: "CA" }, actual: { owner_state: "CA" } },
      { pass: false, slice: "adversarial", itemSnapshot: { caseId: "adv-2" }, expected: { owner_state: "DE", is_stale: true, property_type: "vendor_check" }, actual: { owner_state: "CT", is_stale: true, property_type: "vendor_check" } },
      { pass: false, slice: "adversarial", itemSnapshot: { caseId: "adv-10" }, expected: { is_stale: true }, actual: null },
    ]);
    expect(rows.map((r) => `${r.caseId}:${r.field}`)).toEqual(["adv-2:owner_state", "adv-10:is_stale"].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })));
    expect(rows.find((r) => r.caseId === "adv-10")!.actual).toBe("classifier failed");
  });

  it("formats percentages", () => {
    expect(pct(0.96)).toBe("96.0%");
  });
});
