import { describe, expect, it } from "vitest";
import { heroDeadlineCards, type HeroDeadlineInput } from "./hero-deadlines";

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
