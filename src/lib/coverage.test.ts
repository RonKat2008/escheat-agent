import { describe, expect, it } from "vitest";
import { inScopeStates } from "./coverage-server";
import { isStateCovered, NOT_COVERED_COPY, notCoveredLine, notCoveredStatesLabel, splitByCoverage, UNKNOWN_STATE } from "./coverage";

const RULES = ["CA", "DE", "TX"];
const rows = [
  { state: "CA", cents: 1_000, count: 2 },
  { state: "NY", cents: 240_000, count: 1 },
  { state: "FL", cents: 50_000, count: 2 },
  { state: "IL", cents: 50_000, count: 1 },
  { state: "TX", cents: 500, count: 1 },
];

describe("splitByCoverage", () => {
  it("separates states with rules loaded from the rest and conserves count and cents", () => {
    const s = splitByCoverage(rows, RULES);
    expect(s.inScope.map((r) => r.state)).toEqual(["CA", "TX"]);
    expect(s.inScopeCount).toBe(3);
    expect(s.inScopeCents).toBe(1_500);
    expect(s.summary.count).toBe(4);
    expect(s.summary.cents).toBe(340_000);
    expect(s.summary.count + s.inScopeCount).toBe(7);
    expect(s.summary.cents + s.inScopeCents).toBe(rows.reduce((a, r) => a + r.cents, 0));
  });

  it("orders the not-covered states by amount, then code, and formats the amount", () => {
    const s = splitByCoverage(rows, RULES).summary;
    expect(s.states).toEqual(["NY", "FL", "IL"]);
    expect(s.formatted).toBe("$3,400.00");
    expect(notCoveredLine(s)).toBe("Not covered yet: NY, FL, IL · 4 items · $3,400.00");
  });

  it("never treats an unknown or missing owner state as covered", () => {
    expect(isStateCovered(null, RULES)).toBe(false);
    expect(isStateCovered(UNKNOWN_STATE, RULES)).toBe(false);
    const s = splitByCoverage(
      [
        { state: UNKNOWN_STATE, cents: 100, count: 1 },
        { state: null, cents: 50, count: 1 },
      ],
      RULES,
    ).summary;
    expect(s.hasUnknownState).toBe(true);
    expect(s.states).toEqual([]);
    expect(notCoveredStatesLabel(s)).toBe("no state");
  });

  it("reports nothing when every state is covered", () => {
    const s = splitByCoverage([{ state: "CA", cents: 1, count: 1 }], RULES).summary;
    expect(s).toMatchObject({ count: 0, cents: 0, states: [], hasUnknownState: false });
  });

  it("uses singular wording for one item and states that nothing is guessed", () => {
    const s = splitByCoverage([{ state: "NY", cents: 100, count: 1 }], RULES).summary;
    expect(notCoveredLine(s)).toBe("Not covered yet: NY · 1 item · $1.00");
    expect(NOT_COVERED_COPY).toMatch(/Rules are not loaded/);
    expect(NOT_COVERED_COPY).toMatch(/Nothing here is guessed/);
  });
});

describe("inScopeStates", () => {
  it("is the set of states with a rules file and matches isStateCovered", () => {
    expect(inScopeStates()).toEqual(expect.arrayContaining(["CA", "DE", "TX"]));
    expect(inScopeStates()).not.toContain("NY");
    for (const st of inScopeStates()) expect(isStateCovered(st, inScopeStates())).toBe(true);
  });
});
