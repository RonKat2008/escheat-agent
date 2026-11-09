import { describe, expect, it } from "vitest";
import { heroDeadlineCards, heroDeadlineWhere, type HeroDeadlineInput } from "./hero-deadlines";

const upcoming = (over: Partial<HeroDeadlineInput["upcoming"][number]> = {}): HeroDeadlineInput["upcoming"][number] => ({
  itemId: "i1",
  payeeName: "Bayline Electric",
  state: "CA",
  cents: 421_000,
  kind: "report_due",
  date: "2026-11-15",
  daysUntil: 14,
  verified: true,
  ...over,
});

describe("heroDeadlineCards", () => {
  it("reads an upcoming deadline as Today -> chip -> deadline", () => {
    const [c] = heroDeadlineCards({ asOf: "2026-11-01", overdue: [], upcoming: [upcoming()] });
    expect(c).toMatchObject({
      overdue: false,
      href: "/items?item=i1",
      from: { label: "Today", value: "Nov 1" },
      to: { label: "Report due", value: "Nov 15" },
      chip: "14 days",
    });
  });

  it("puts overdue obligations first and reads them deadline -> late chip -> Today", () => {
    const cards = heroDeadlineCards({
      asOf: "2026-11-01",
      overdue: [{ itemId: "o1", payeeName: "Late Co", state: "TX", cents: 1000, kind: "remit_due", date: "2026-10-31", daysLate: 1, verified: false }],
      upcoming: [upcoming(), upcoming({ itemId: "i2" })],
    });
    expect(cards).toHaveLength(2);
    expect(cards[0]).toMatchObject({ overdue: true, chip: "1 day late", from: { label: "Remit due", value: "Oct 31" }, to: { label: "Today" }, verified: false });
    expect(cards[1]?.key).toBe("next-i1-report_due");
  });

  it("skips due-diligence window openings and says Due today at zero days", () => {
    const cards = heroDeadlineCards({
      asOf: "2026-11-01",
      overdue: [],
      upcoming: [upcoming({ kind: "dd_window_start", itemId: "x" }), upcoming({ daysUntil: 0, date: "2026-11-01" })],
    });
    expect(cards.map((c) => c.chip)).toEqual(["Due today"]);
  });

  it("returns nothing when there is nothing due", () => {
    expect(heroDeadlineCards({ asOf: "2026-11-01", overdue: [], upcoming: [] })).toEqual([]);
  });
});

describe("heroDeadlineWhere (R11-14)", () => {
  it("names only the states of the rows shown, not the whole exposure footprint", () => {
    expect(heroDeadlineWhere("2026-11-01", [{ state: "TX" }, { state: "TX" }])).toBe("As of Nov 1, 2026 · TX");
  });
  it("lists distinct states in row order and caps the list", () => {
    expect(heroDeadlineWhere("2026-11-01", [{ state: "CA" }, { state: "TX" }, { state: "CA" }])).toBe("As of Nov 1, 2026 · CA, TX");
    expect(heroDeadlineWhere("2026-11-01", ["CA", "TX", "DE"].map((state) => ({ state })), 2)).toBe("As of Nov 1, 2026 · CA, TX +1");
  });
  it("is just the date when no row names a state", () => {
    expect(heroDeadlineWhere("2026-11-01", [])).toBe("As of Nov 1, 2026");
    expect(heroDeadlineWhere("2026-11-01", [{ state: null }])).toBe("As of Nov 1, 2026");
  });
});
