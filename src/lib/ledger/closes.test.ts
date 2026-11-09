import { describe, expect, it } from "vitest";
import { applyCloses, closeOrder, coverageOf, nextClosableMonth, nextOpenMonth, withFrozenEntries, type ClosedPeriod } from "./closes";
import { buildJournal } from "./journal";
import { allMovements } from "./movements";
import { rollForward, type Period } from "./rollforward";
import { item } from "./test-items";

const TODAY_AT_CLOSE = "2026-11-20";
const early = item({ state: "TX", staleSince: "2026-11-02", amountCents: 45_051 });
const closeData = () => {
  const ms = allMovements([early], [], TODAY_AT_CLOSE);
  return { ms, journal: buildJournal(ms) };
};

describe("closed months", () => {
  it("a closed month's entries are frozen verbatim and later grouping cannot change them", () => {
    const { journal } = closeData();
    const closes: ClosedPeriod[] = [{ period: "2026-11", entries: journal.entries }];
    // A second TX vendor check, backdated into November, is detected after the close.
    const late = item({ state: "TX", staleSince: "2026-11-25", amountCents: 22_978 });
    const ms = applyCloses(allMovements([early, late], [], "2026-12-16"), closes);
    const j = withFrozenEntries(buildJournal(ms), closes, "2026-11-01", "2026-11-30");
    expect(j.entries.filter((e) => e.date <= "2026-11-30")).toEqual(journal.entries);
    // the backdated item is not in November: it is a prior-period adjustment dated Dec 1
    expect(j.entries.filter((e) => e.date > "2026-11-30").map((e) => [e.date, e.je])).toEqual([["2026-12-01", "JE-TX-202612-PPA-01"]]);
    expect(j.entries[0]!.je).toBe("JE-TX-202611-01");
    expect(j.entries[0]!.lines[0]!.debitCents).toBe(45_051);
  });

  it("an item backdated into a closed month posts to the next open month as a labelled prior-period adjustment", () => {
    const { journal } = closeData();
    const closes: ClosedPeriod[] = [{ period: "2026-11", entries: journal.entries }];
    const late = item({ state: "FL", staleSince: "2026-11-25", amountCents: 10_000 });
    const ms = applyCloses(allMovements([early, late], [], "2026-12-16"), closes);
    const lateMove = ms.find((m) => m.itemId === late.id)!;
    expect(lateMove).toMatchObject({ date: "2026-12-01", priorPeriodOf: "2026-11" });
    const j = buildJournal(ms);
    const adj = j.entries.find((e) => e.state === "FL")!;
    expect(adj.date).toBe("2026-12-01");
    expect(adj.priorPeriodOf).toBe("2026-11");
    expect(adj.je).toBe("JE-FL-202612-PPA-01");
    expect(adj.memo).toMatch(/^Prior-period adjustment \(Nov 2026 is closed\)/);
    expect(j.balanced).toBe(true);
    // November's covered movement is untouched.
    expect(ms.find((m) => m.itemId === early.id)!.date).toBe("2026-11-02");
  });

  it("skips months that are closed too when picking the next open month", () => {
    expect(nextOpenMonth("2026-11", new Set(["2026-11", "2026-12"]))).toBe("2027-01");
    expect(nextOpenMonth("2026-10", new Set(["2026-10"]))).toBe("2026-11");
  });

  it("changes nothing when no month is closed", () => {
    const ms = allMovements([early], [], TODAY_AT_CLOSE);
    expect(applyCloses(ms, [])).toEqual(ms);
  });
});

const month = (ym: string, end: string): Period => ({ id: "month", label: ym, start: `${ym}-01`, end });

describe("closed books stay frozen (R11-01)", () => {
  // Books at the October close: an old CA item from 2024 (opening balance) and an October TX item.
  const old = item({ state: "CA", staleSince: "2024-05-10", amountCents: 50_000 });
  const oct = item({ state: "TX", staleSince: "2026-10-12", amountCents: 20_000 });
  const atClose = allMovements([old, oct], [], "2026-11-01");
  const closeOct = (): ClosedPeriod => ({
    period: "2026-10",
    entries: buildJournal(atClose.filter((m) => m.date >= "2026-10-01")).entries,
    covered: coverageOf(atClose, "2026-10-31"),
  });
  const frozenOct = rollForward(atClose, month("2026-10", "2026-10-31")).total;

  it("a backdated import dated years before the closed month posts to the next open month, not into history", () => {
    const back1 = item({ state: "CA", staleSince: "2024-04-12", amountCents: 73_310 });
    const back2 = item({ state: "TX", staleSince: "2022-04-09", amountCents: 61_525 });
    const ms = applyCloses(allMovements([old, oct, back1, back2], [], "2026-11-02"), [closeOct()]);
    // October's figures are what they were at close
    expect(rollForward(ms, month("2026-10", "2026-10-31")).total).toEqual(frozenOct);
    const nov = rollForward(ms, month("2026-11", "2026-11-02"));
    expect(nov.total.opening).toBe(frozenOct.closing);
    expect(nov.total.priorPeriod).toBe(73_310 + 61_525);
    expect(nov.total.identified).toBe(0);
    expect(nov.total.closing).toBe(frozenOct.closing + 134_835);
    expect(nov.total.reconciles).toBe(true);
    expect(nov.adjustment).toEqual({ count: 2, cents: 134_835, months: ["2022-04", "2024-04"], postedIn: "2026-11" });
    const ppa = buildJournal(nov.movements).entries;
    expect(ppa.map((e) => e.je).sort()).toEqual(["JE-CA-202611-PPA-01", "JE-TX-202611-PPA-01"]);
    expect(ppa.every((e) => e.memo.startsWith("Prior-period adjustment"))).toBe(true);
  });

  it("a settlement dated back inside the closed books is an adjustment too (negative)", () => {
    const paidBack = { ...old, status: "resolved_paid", classification: { resolution: { at: "2026-10-20" } } };
    const ms = applyCloses(allMovements([paidBack, oct], [], "2026-11-05"), [closeOct()]);
    expect(rollForward(ms, month("2026-10", "2026-10-31")).total).toEqual(frozenOct);
    const nov = rollForward(ms, month("2026-11", "2026-11-05")).total;
    expect(nov.priorPeriod).toBe(-50_000);
    expect(nov.resolved).toBe(0);
    expect(nov.closing).toBe(frozenOct.closing - 50_000);
  });

  it("a covered movement keeps its frozen date even if the source would now date it differently", () => {
    const moved = { ...oct, staleSince: "2026-09-02" };
    const ms = applyCloses(allMovements([old, moved], [], "2026-11-02"), [closeOct()]);
    expect(ms.find((m) => m.itemId === oct.id)!.date).toBe("2026-10-12");
  });

  it("an adjustment covered by the next close stays an adjustment in that month, without duplicating", () => {
    const back = item({ state: "CA", staleSince: "2025-01-15", amountCents: 1_000 });
    const nowMs = applyCloses(allMovements([old, oct, back], [], "2026-12-01"), [closeOct()]);
    const closeNov: ClosedPeriod = {
      period: "2026-11",
      entries: buildJournal(nowMs.filter((m) => m.date.startsWith("2026-11"))).entries,
      covered: coverageOf(nowMs, "2026-11-30"),
    };
    const later = applyCloses(allMovements([old, oct, back], [], "2026-12-01"), [closeOct(), closeNov]);
    expect(later.find((m) => m.itemId === back.id)).toMatchObject({ date: "2026-11-01", priorPeriodOf: "2025-01" });
    const j = withFrozenEntries(buildJournal(later), [closeOct(), closeNov], "2026-11-01", "2026-11-30");
    expect(j.entries.filter((e) => e.date.startsWith("2026-11"))).toEqual(closeNov.entries);
  });
});

describe("months close in order (R11-04)", () => {
  const activity = ["2026-12", "2026-11", "2026-10", "2026-09", "2024-05"];
  it("the first close may be any month with activity", () => {
    expect(closeOrder("2026-10", [], activity)).toEqual({ ok: true });
    expect(closeOrder("2024-05", [], activity)).toEqual({ ok: true });
    expect(nextClosableMonth([], activity)).toBeNull();
  });
  it("after a close only the earliest later month with activity can close", () => {
    expect(nextClosableMonth(["2026-10"], activity)).toBe("2026-11");
    expect(closeOrder("2026-11", ["2026-10"], activity)).toEqual({ ok: true });
    expect(closeOrder("2026-09", ["2026-10"], activity)).toEqual({ ok: false, nextClosable: "2026-11", reason: "inside_closed" });
    expect(closeOrder("2026-12", ["2026-10"], activity)).toEqual({ ok: false, nextClosable: "2026-11", reason: "out_of_order" });
  });
  it("skips months with no activity", () => {
    expect(nextClosableMonth(["2024-05"], activity)).toBe("2026-09");
  });
});
