import { describe, expect, it } from "vitest";
import { scoreEval, type EvalActual, type EvalCaseLite, type EvalExpected } from "./eval-score";

const exp = (o: Partial<EvalExpected> = {}): EvalExpected => ({
  property_type: "vendor_check",
  owner_state: "CA",
  owner_state_basis: "address",
  is_stale: true,
  ...o,
});

describe("scoreEval", () => {
  const cases: EvalCaseLite[] = [
    { id: "a", slice: "generated", expected: exp() },
    { id: "b", slice: "generated", expected: exp({ owner_state: "TX" }) },
    { id: "c", slice: "adversarial", expected: exp({ is_stale: false }) },
    { id: "d", slice: "adversarial", expected: exp() },
  ];
  const results = new Map<string, EvalActual>([
    ["a", exp()],
    ["b", exp({ owner_state: "CA", property_type: "payroll_check" })],
    ["c", exp({ is_stale: false })],
    ["d", null],
  ]);
  const s = scoreEval(cases, results);

  it("computes per-field accuracy overall", () => {
    expect(s.overall.property_type).toMatchObject({ correct: 2, total: 4, accuracy: 0.5 });
    expect(s.overall.owner_state).toMatchObject({ correct: 2, total: 4 });
    expect(s.overall.is_stale).toMatchObject({ correct: 3, total: 4, accuracy: 0.75 });
    expect(s.overall.all_fields).toMatchObject({ correct: 2, total: 4 });
  });
  it("computes per-slice accuracy", () => {
    expect(s.bySlice.generated?.property_type.accuracy).toBe(0.5);
    expect(s.bySlice.adversarial?.all_fields.accuracy).toBe(0.5);
  });
  it("lists every error, with a failed classification as a single error entry", () => {
    expect(s.errors.filter((e) => e.id === "b").map((e) => e.field).sort()).toEqual(["owner_state", "property_type"]);
    expect(s.errors.filter((e) => e.id === "d")).toEqual([
      expect.objectContaining({ field: "error", actual: null }),
    ]);
    expect(s.passByCase).toEqual({ a: true, b: false, c: true, d: false });
  });
  it("handles an empty set", () => {
    expect(scoreEval([], new Map()).overall.all_fields.accuracy).toBe(0);
  });
});
