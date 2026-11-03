import { describe, expect, it } from "vitest";
import { dueWithin, filterByView, stateRibbon, viewCounts, type ViewRow } from "./view-model";

const row = (id: string, state: string | null, cents: number, date: string | null): ViewRow => ({
  id,
  ownerState: state,
  amount: { cents },
  nextDeadline: date ? { date } : null,
});

const rows = [row("a", "CA", 1000, "2026-11-20"), row("b", "TX", 3000, "2027-06-01"), row("c", "TX", 0, null), row("d", null, 500, "2026-10-01")];
const sets = { needsAction: new Set(["a", "c"]), draftReady: new Set(["b"]) };
const asOf = "2026-11-01";

describe("saved views", () => {
  it("All keeps everything; Needs action and Draft-ready use the server's membership sets", () => {
    expect(filterByView(rows, "all", sets, asOf)).toHaveLength(4);
    expect(filterByView(rows, "needs-action", sets, asOf).map((r) => r.id)).toEqual(["a", "c"]);
    expect(filterByView(rows, "draft-ready", sets, asOf).map((r) => r.id)).toEqual(["b"]);
  });

  it("Due ≤ 90d counts only upcoming engine deadlines within 90 days (not missed ones, not undated)", () => {
    expect(filterByView(rows, "due-90", sets, asOf).map((r) => r.id)).toEqual(["a"]);
    expect(dueWithin(row("x", "CA", 1, "2027-01-30"), asOf)).toBe(true);
    expect(dueWithin(row("x", "CA", 1, "2027-01-31"), asOf)).toBe(false);
    expect(dueWithin(row("x", "CA", 1, "2026-11-01"), asOf)).toBe(true);
  });

  it("counts every view at once", () => {
    expect(viewCounts(rows, sets, asOf)).toEqual({ all: 4, "needs-action": 2, "draft-ready": 1, "due-90": 1 });
  });
});

describe("stateRibbon", () => {
  it("groups by owner state, largest amount first, unknown last, shares summing to 1", () => {
    const r = stateRibbon(rows);
    expect(r.map((s) => s.state)).toEqual(["TX", "CA", null]);
    expect(r[0]).toMatchObject({ cents: 3000, count: 2 });
    expect(r.reduce((a, s) => a + s.share, 0)).toBeCloseTo(1, 6);
  });

  it("keeps a visible sliver for a zero-amount state and handles an empty list", () => {
    const r = stateRibbon([row("a", "CA", 1_000_000, null), row("b", "DE", 0, null)]);
    expect(r.find((s) => s.state === "DE")!.share).toBeGreaterThan(0.03);
    expect(stateRibbon([])).toEqual([]);
  });
});
