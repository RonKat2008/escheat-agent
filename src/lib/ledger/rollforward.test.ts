import { describe, expect, it } from "vitest";
import { addDays, type IsoDate } from "@/lib/dates";
import { allMovements, type LedgerItem } from "./movements";
import { balanceAsOf, earliestDate, fiscalYear, itemsBehind, PERIOD_IDS, periodFor, rollForward, type Period, type Roll } from "./rollforward";
import { item, rng } from "./test-items";

const STATES = ["CA", "DE", "TX", null];
const TYPES = ["vendor_check", "payroll_check", "customer_credit", "unapplied_cash"] as const;

/** 120 items across states and types, stale over 2024-2026, a third settled one way or another. */
function randomItems(seed: number): LedgerItem[] {
  const r = rng(seed);
  const day = (from: string, span: number) => addDays(from as IsoDate, Math.floor(r() * span));
  return Array.from({ length: 120 }, () => {
    const staleSince = day("2024-01-01", 1000);
    const pick = r();
    const settled = day(staleSince, 300);
    const base = { state: STATES[Math.floor(r() * STATES.length)]!, propertyType: TYPES[Math.floor(r() * TYPES.length)]!, amountCents: 1 + Math.floor(r() * 500_000), staleSince };
    if (pick < 0.15) return item({ ...base, status: "remitted", classification: { remittance: { reportId: `r-${Math.floor(r() * 3)}`, remittedOn: settled, reference: null } } });
    if (pick < 0.25) return item({ ...base, status: "resolved_paid", classification: { resolution: { at: settled } } });
    if (pick < 0.3) return item({ ...base, status: "resolved_paid", lateClearDate: settled });
    return item({ ...base, status: pick < 0.4 ? "reported" : "watching" });
  });
}

function expectIdentity(r: Roll, closingAtEnd: number) {
  expect(r.opening + r.identified - r.resolved - r.clearedLate - r.remitted).toBe(r.closing);
  expect(r.closing).toBe(closingAtEnd);
  expect(r.reconciles).toBe(true);
  for (const v of [r.opening, r.identified, r.resolved, r.clearedLate, r.remitted, r.closing]) expect(Number.isInteger(v)).toBe(true);
}

describe("rollForward: the identity", () => {
  const items = randomItems(42);
  const ms = allMovements(items, [], "2026-11-01");

  it("holds exactly at every period edge (each movement date, the day before and after)", () => {
    const edges = [...new Set(ms.flatMap((m) => [addDays(m.date as IsoDate, -1), m.date, addDays(m.date as IsoDate, 1)]))].sort();
    for (let i = 0; i < edges.length; i += 7) {
      const start = edges[i]!;
      for (const end of [start, edges[Math.min(i + 5, edges.length - 1)]!, edges.at(-1)!]) {
        if (end < start) continue;
        const period: Period = { id: "all", label: "x", start, end };
        const rf = rollForward(ms, period);
        expectIdentity(rf.total, balanceAsOf(ms, end));
        // States add up to the total, line by line.
        for (const k of ["opening", "identified", "resolved", "clearedLate", "remitted", "closing"] as const) {
          expect(rf.states.reduce((a, s) => a + s[k], 0)).toBe(rf.total[k]);
        }
        for (const s of rf.states) expectIdentity(s, balanceAsOf(ms.filter((m) => m.state === s.state), end));
        // Consecutive periods chain: this closing is the next day's opening.
        const next = rollForward(ms, { ...period, start: addDays(end as IsoDate, 1), end: addDays(end as IsoDate, 1) });
        expect(next.total.opening).toBe(rf.total.closing);
      }
    }
  });

  it("holds for every chip, before and after a demo-clock jump, and movements keep their dates", () => {
    for (const today of ["2026-11-01", "2027-02-14", "2027-07-01"]) {
      const after = allMovements(items, [{ atMs: 0, day: today }], today);
      expect(after.map((m) => m.date)).toEqual(ms.map((m) => m.date));
      for (const id of PERIOD_IDS) {
        const period = periodFor(id, today, "12-31", earliestDate(after));
        expect(period.end).toBe(today);
        expectIdentity(rollForward(after, period).total, balanceAsOf(after, today));
      }
    }
  });

  it("Since start opens at zero and its identified is every item ever recognized", () => {
    const period = periodFor("all", "2026-11-01", "12-31", earliestDate(ms));
    const rf = rollForward(ms, period);
    expect(rf.total.opening).toBe(0);
    expect(rf.total.identified).toBe(items.filter((i) => i.staleSince <= "2026-11-01").reduce((a, i) => a + i.amountCents, 0));
  });

  it("only shows Cleared late when an item ever cleared late", () => {
    expect(rollForward(ms, periodFor("fy", "2026-11-01", "12-31", null)).anyClearedLate).toBe(true);
    const plain = allMovements([item()], [], "2026-11-01");
    expect(rollForward(plain, periodFor("fy", "2026-11-01", "12-31", null)).anyClearedLate).toBe(false);
  });

  it("itemsBehind lists the items each bar is made of, summing to the bar", () => {
    const period = periodFor("fy", "2026-11-01", "12-31", null);
    const rf = rollForward(ms, period);
    const b = itemsBehind(ms, period);
    const sum = (xs: { amountCents: number }[]) => xs.reduce((a, m) => a + m.amountCents, 0);
    expect(sum(b.opening)).toBe(rf.total.opening);
    expect(sum(b.identified)).toBe(rf.total.identified);
    expect(sum(b.resolved)).toBe(rf.total.resolved);
    expect(sum(b.cleared_late)).toBe(rf.total.clearedLate);
    expect(sum(b.remitted)).toBe(rf.total.remitted);
    expect(sum(b.closing)).toBe(rf.total.closing);
  });
});

describe("periods", () => {
  it("fiscal year for a calendar and a June year end", () => {
    expect(fiscalYear("2026-11-01", "12-31")).toEqual({ start: "2026-01-01", end: "2026-12-31", year: 2026 });
    expect(fiscalYear("2026-11-01", "06-30")).toEqual({ start: "2026-07-01", end: "2027-06-30", year: 2027 });
    expect(fiscalYear("2026-06-30", "06-30")).toEqual({ start: "2025-07-01", end: "2026-06-30", year: 2026 });
  });

  it("chips: month, fiscal quarter, FY and since start, all ending on the demo date", () => {
    expect(periodFor("month", "2026-11-01", "12-31", null)).toMatchObject({ start: "2026-11-01", end: "2026-11-01", label: "This month" });
    expect(periodFor("quarter", "2026-11-01", "12-31", null)).toMatchObject({ start: "2026-10-01", end: "2026-11-01" });
    expect(periodFor("quarter", "2026-11-01", "06-30", null)).toMatchObject({ start: "2026-10-01" });
    expect(periodFor("quarter", "2026-02-10", "12-31", null)).toMatchObject({ start: "2026-01-01" });
    expect(periodFor("fy", "2026-11-01", "12-31", null)).toMatchObject({ start: "2026-01-01", label: "FY 2026" });
    expect(periodFor("all", "2026-11-01", "12-31", "2024-05-19")).toMatchObject({ start: "2024-05-19", label: "Since start" });
    expect(periodFor("all", "2026-11-01", "12-31", null).start).toBe("2026-11-01");
  });
});
