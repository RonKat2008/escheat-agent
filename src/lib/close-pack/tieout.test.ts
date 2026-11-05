import { describe, expect, it } from "vitest";
import type { Journal, JournalEntry } from "@/lib/ledger/journal";
import type { Roll, RollForward } from "@/lib/ledger/rollforward";
import { buildRollForwardPdf, buildTieOutPdf } from "./pdf";
import { monthPeriod, monthsWithActivity } from "./period";
import { allTie, computeTieOut, type TieOutInput } from "./tieout";

const roll = (state: string, o: Partial<Roll> = {}): Roll => ({ state, opening: 1000, identified: 500, resolved: 100, clearedLate: 0, remitted: 200, closing: 1200, reconciles: true, ...o });
const entry = (state: string, cents: number, kind: "identified" | "remitted"): JournalEntry =>
  ({
    state,
    kind,
    lines:
      kind === "identified"
        ? [
            { account: { code: "1000", name: "Cash" }, debitCents: cents, creditCents: 0 },
            { account: { code: `2400-${state}`, name: "p" }, debitCents: 0, creditCents: cents },
          ]
        : [
            { account: { code: `2400-${state}`, name: "p" }, debitCents: cents, creditCents: 0 },
            { account: { code: "1000", name: "Cash" }, debitCents: 0, creditCents: cents },
          ],
  }) as unknown as JournalEntry;

function fixture(over: Partial<TieOutInput> = {}): TieOutInput {
  const ca = roll("CA");
  const rf = { states: [ca], total: roll("Total") } as unknown as RollForward;
  const journal = {
    entries: [entry("CA", 500, "identified"), entry("CA", 100, "remitted"), entry("CA", 200, "remitted")],
    byState: [{ state: "CA", debitCents: 800, creditCents: 800, balanced: true }],
    debitCents: 800,
    creditCents: 800,
    balanced: true,
  } as unknown as Journal;
  return {
    journal,
    roll: rf,
    payableByState: new Map([["CA", 1200]]),
    activity: { csvRows: 7, loadedRows: 7, truncated: false },
    chain: { length: 7, head: "a".repeat(64), verified: true },
    files: [{ name: "journal-2026-11.csv", sha256: "b".repeat(64), bytes: 10 }],
    ...over,
  };
}

describe("computeTieOut", () => {
  it("ties a consistent fixture, line by line", () => {
    const lines = computeTieOut(fixture());
    expect(lines.filter((l) => l.status !== "tie")).toEqual([]);
    expect(allTie(lines)).toBe(true);
  });

  it("says 'does not tie' with the difference for a non-tying fixture, and never forces a tie", () => {
    const lines = computeTieOut(
      fixture({
        journal: { ...fixture().journal, byState: [{ state: "CA", debitCents: 800, creditCents: 750, balanced: false }], debitCents: 800, creditCents: 750 },
        roll: { states: [roll("CA", { closing: 1250 })], total: roll("Total", { closing: 1250 }) } as unknown as RollForward,
        payableByState: new Map([["CA", 1200]]),
        activity: { csvRows: 7, loadedRows: 6, truncated: false },
        chain: { length: 7, head: "a".repeat(64), verified: false },
      }),
    );
    const byId = Object.fromEntries(lines.map((l) => [l.id, l]));
    expect(byId["journal-CA"]).toMatchObject({ status: "no_tie" });
    expect(byId["journal-CA"]!.detail).toContain("difference $0.50");
    expect(byId["roll-CA"]!.status).toBe("no_tie");
    expect(byId["payable-CA"]!.status).toBe("no_tie");
    expect(byId["payable-CA"]!.detail).toContain("difference $0.50");
    expect(byId["activity-count"]!.status).toBe("no_tie");
    expect(byId.chain!.status).toBe("no_tie");
    expect(allTie(lines)).toBe(false);
  });

  it("reports 'not available' with a reason when the payable cannot be computed", () => {
    const lines = computeTieOut(fixture({ payableByState: null, payableNote: "no item-level data", chain: null }));
    expect(lines.find((l) => l.id === "payable-CA")).toMatchObject({ status: "n/a", detail: "not available: no item-level data" });
    expect(lines.find((l) => l.id === "chain")!.detail).toContain("not available");
  });

  it("flags a truncated activity export instead of counting it", () => {
    const l = computeTieOut(fixture({ activity: { csvRows: 5000, loadedRows: 5000, truncated: true } })).find((x) => x.id === "activity-count")!;
    expect(l.status).toBe("no_tie");
  });
});

describe("PDFs", () => {
  it("builds the tie-out with a 'does not tie' line and the roll-forward", async () => {
    const lines = computeTieOut(fixture({ activity: { csvRows: 7, loadedRows: 6, truncated: false } }));
    const tie = await buildTieOutPdf({ periodLabel: "Nov 2026", demoDate: "2026-11-04", lines });
    const rf = await buildRollForwardPdf({ periodLabel: "Nov 2026", start: "2026-11-01", end: "2026-11-04", demoDate: "2026-11-04", states: [roll("CA")], total: roll("Total") });
    expect(Buffer.from(tie.slice(0, 4)).toString()).toBe("%PDF");
    expect(Buffer.from(rf.slice(0, 4)).toString()).toBe("%PDF");
  });
});

describe("period", () => {
  it("clamps the month end to the demo date and refuses future months", () => {
    expect(monthPeriod("2026-11", "2026-11-04")).toEqual({ ok: true, period: { id: "month", label: "Nov 2026", start: "2026-11-01", end: "2026-11-04" } });
    expect(monthPeriod("2026-02", "2026-11-04")).toMatchObject({ ok: true, period: { end: "2026-02-28" } });
    expect(monthPeriod("2026-12", "2026-11-04").ok).toBe(false);
    expect(monthPeriod("2026-13", "2026-11-04").ok).toBe(false);
  });
  it("lists months with movements, newest first, always including the current month", () => {
    expect(monthsWithActivity([{ date: "2026-09-02" }, { date: "2026-10-10" }, { date: "2027-01-01" }], "2026-11-04")).toEqual(["2026-11", "2026-10", "2026-09"]);
  });
});
