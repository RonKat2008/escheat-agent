import { describe, expect, it } from "vitest";
import { describeMethod, errorRows, pct, sliceRows, usesModels } from "./eval-model";

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

  it("F35: lists model names only when a model classified the run", () => {
    expect(usesModels(describeMethod("heuristic", "w", "o"))).toBe(false);
    expect(usesModels(describeMethod(undefined, "w", "o"))).toBe(false);
    expect(usesModels(describeMethod("model", "w", "o"))).toBe(true);
    expect(usesModels(describeMethod("replay", "w", "o"))).toBe(true);
  });

  it("shapes per-slice accuracy: overall first, missing slices stay unknown", () => {
    const g = { correct: 9, total: 10, accuracy: 0.9 };
    const rows = sliceRows({ all_fields: { correct: 9, total: 12, accuracy: 0.75 } }, { generated: { all_fields: g }, zeta: {} });
    expect(rows.map((r) => r.key)).toEqual(["overall", "generated", "adversarial", "zeta"]);
    expect(rows[1]!.stat).toEqual(g);
    expect(rows[2]!.stat).toBeNull();
    expect(rows[3]!.label).toBe("Zeta");
    expect(sliceRows(undefined, undefined).every((r) => r.stat === null)).toBe(true);
  });
});
