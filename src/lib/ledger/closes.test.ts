import { describe, expect, it } from "vitest";
import { applyCloses, nextOpenMonth, withFrozenEntries, type ClosedPeriod } from "./closes";
import { buildJournal } from "./journal";
import { allMovements } from "./movements";
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
