import { describe, expect, it } from "vitest";
import { inUrgentWindow, layoutRiver, monthTicks, segmentHeight, URGENT_DAYS, urgentSummary, type RiverEvent } from "./river-model";

const ev = (date: string, kind: RiverEvent["kind"], over: Partial<RiverEvent> = {}): RiverEvent => ({ date, kind, state: "CA", amountCents: 1000, verified: true, ...over });
const AS_OF = "2026-11-01";
const END = "2027-11-01";

describe("deadline river layout", () => {
  it("stacks one segment per kind per day, in fixed kind order, bottom up and contiguous", () => {
    const l = layoutRiver(
      [ev("2026-12-15", "remit_due"), ev("2026-12-15", "presumed_abandoned"), ev("2026-12-15", "report_due", { state: "TX" }), ev("2026-12-15", "report_due")],
      { asOf: AS_OF, end: END },
    );
    expect(l.columns).toHaveLength(1);
    const [col] = l.columns;
    expect(col!.segments.map((s) => s.kind)).toEqual(["presumed_abandoned", "report_due", "remit_due"]);
    expect(col!.segments[0]!.y0).toBe(0);
    for (let i = 1; i < col!.segments.length; i++) expect(col!.segments[i]!.y0).toBe(col!.segments[i - 1]!.y1 + 1);
    const report = col!.segments[1]!;
    expect(report.count).toBe(2);
    expect(report.cents).toBe(2000);
    expect(report.states).toEqual(["CA", "TX"]);
    expect(col!.count).toBe(4);
    expect(col!.height).toBe(col!.segments.at(-1)!.y1);
  });

  it("marks a segment unverified when any of its events is, and keeps columns sorted by date", () => {
    const l = layoutRiver([ev("2027-02-01", "remit_due"), ev("2026-11-20", "remit_due", { verified: false }), ev("2026-11-20", "remit_due")], { asOf: AS_OF, end: END });
    expect(l.columns.map((c) => c.date)).toEqual(["2026-11-20", "2027-02-01"]);
    expect(l.columns[0]!.segments[0]!.verified).toBe(false);
    expect(l.columns[1]!.segments[0]!.verified).toBe(true);
  });

  it("drops events before today or at/after the window end instead of clamping them", () => {
    const l = layoutRiver([ev("2026-10-31", "report_due"), ev(END, "report_due"), ev(AS_OF, "report_due"), ev("2027-10-31", "report_due")], { asOf: AS_OF, end: END });
    expect(l.columns.map((c) => c.date)).toEqual([AS_OF, "2027-10-31"]);
    expect(l.dropped).toBe(2);
  });

  it("shades exactly today through today + 7 days as the urgent window", () => {
    expect(URGENT_DAYS).toBe(7);
    expect(inUrgentWindow(AS_OF, AS_OF)).toBe(true);
    expect(inUrgentWindow("2026-11-08", AS_OF)).toBe(true);
    expect(inUrgentWindow("2026-11-09", AS_OF)).toBe(false);
    expect(inUrgentWindow("2026-10-31", AS_OF)).toBe(false);
    const l = layoutRiver([ev("2026-11-08", "remit_due"), ev("2026-11-09", "remit_due")], { asOf: AS_OF, end: END, pxPerDay: 4 });
    expect(l.columns.map((c) => c.urgent)).toEqual([true, false]);
    expect(l.window).toEqual([0, 8 * 4]);
    // every urgent column sits inside the shaded band, every other one outside it
    for (const c of l.columns) expect(c.x >= l.window[0] && c.x <= l.window[1]).toBe(c.urgent);
  });

  it("places today at the left edge, sizes the plot by days and puts month ticks on the 1st", () => {
    const l = layoutRiver([], { asOf: "2026-11-15", end: "2027-02-01", pxPerDay: 2 });
    expect(l.todayX).toBe(0);
    expect(l.days).toBe(78);
    expect(l.width).toBe(156);
    expect(l.columns).toEqual([]);
    expect(monthTicks("2026-11-15", "2027-02-01", (d) => d.length).map((t) => t.date)).toEqual(["2026-11-15", "2026-12-01", "2027-01-01"]);
  });

  it("grows segment height with the square root of the count, capped, and draws nothing for zero", () => {
    expect(segmentHeight(0)).toBe(0);
    expect(segmentHeight(1)).toBe(6);
    expect(segmentHeight(4)).toBe(11);
    expect(segmentHeight(10_000)).toBe(40);
  });
});

describe("urgentSummary (R7-12)", () => {
  const cols = (events: RiverEvent[]) => layoutRiver(events, { asOf: AS_OF, end: END }).columns;
  it("names filing dates and due-diligence openings separately, counting dates not items", () => {
    const c = cols([ev("2026-11-03", "report_due"), ev("2026-11-03", "report_due", { state: "TX" }), ev("2026-11-05", "remit_due"), ev("2026-11-06", "dd_window_opens")]);
    expect(urgentSummary(c)).toBe("2 filing dates and 1 due-diligence opening");
  });
  it("is null when only presumed-abandoned or far-off dates exist", () => {
    expect(urgentSummary(cols([ev("2026-11-03", "presumed_abandoned"), ev("2027-05-01", "report_due")]))).toBeNull();
  });
});
