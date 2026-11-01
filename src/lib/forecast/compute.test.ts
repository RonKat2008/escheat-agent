import { describe, expect, it } from "vitest";
import type { IsoDate } from "@/lib/dates";
import { computeTimeline, type DatedValue, type Timeline } from "@/lib/rules/engine";
import { rv, simpleFile, twoStageFile } from "@/lib/rules/__fixtures__";
import type { RuleFile } from "../../../rules/schema";
import {
  buildForecast,
  calendarDeadlines,
  clampHorizon,
  DEFAULT_HORIZON_MONTHS,
  monthBuckets,
  type ForecastItemInput,
} from "./compute";

const d = (s: string) => s as IsoDate;
const ASOF = d("2026-11-01");

/** An item whose dates come from the real engine and a SYNTHETIC fixture rule file. */
function engineItem(id: string, file: RuleFile, over: { lastActivity?: string; cents?: number; type?: "vendor_check" | "payroll_check" } = {}): ForecastItemInput {
  const amountCents = over.cents ?? 100_000;
  return {
    itemId: id,
    checkNumber: id,
    payeeName: `Payee ${id}`,
    state: file.state,
    amountCents,
    timeline: computeTimeline(
      { propertyType: over.type ?? "vendor_check", lastActivityDate: d(over.lastActivity ?? "2024-03-15"), amountCents, ownerState: file.state },
      file,
    ),
  };
}

const ok = (date: string, verified = true): DatedValue => ({ date: d(date), status: "ok", verified, ruleRefs: [], sources: [], notes: [] });
const na = (): DatedValue => ({ date: null, status: "not_applicable", verified: true, ruleRefs: [], sources: [], notes: [] });

/** Hand-built timeline for exact-date edge cases (only the fields the forecast reads matter). */
function fixedItem(id: string, dates: { presumed?: string; ddStart?: string; report?: string; remit?: string }, state = "ZZ"): ForecastItemInput {
  const v = (x?: string) => (x ? ok(x) : na());
  const timeline: Timeline = {
    state,
    propertyType: "vendor_check",
    rules: { state, version: "test" },
    presumedAbandoned: v(dates.presumed),
    ddApplies: Boolean(dates.ddStart),
    ddWindow: { start: v(dates.ddStart), end: na() },
    reportStages: [{ name: "annual", asOf: na(), due: v(dates.report), includesRemittance: true }],
    remitDue: v(dates.remit),
    minAmountApplies: false,
    aggregate: false,
    anyUnverified: false,
    anyUnknown: false,
    warnings: [],
  };
  return { itemId: id, checkNumber: id, payeeName: id, state, amountCents: 1_000, timeline };
}

describe("month bucketing", () => {
  it("makes horizon calendar months from the simulated today, end exclusive", () => {
    const { buckets, end } = monthBuckets(ASOF, 18);
    expect(buckets).toHaveLength(18);
    expect(buckets[0]).toEqual({ month: "2026-11", from: "2026-11-01", to: "2026-11-30" });
    expect(buckets[17]).toEqual({ month: "2028-04", from: "2028-04-01", to: "2028-04-30" });
    expect(end).toBe("2028-05-01");
  });

  it("starts the first bucket at today when today is mid-month", () => {
    const { buckets } = monthBuckets(d("2026-11-17"), 2);
    expect(buckets[0]).toEqual({ month: "2026-11", from: "2026-11-17", to: "2026-11-30" });
    expect(buckets[1]!.from).toBe("2026-12-01");
  });

  it("places engine dates into the right month, by state", () => {
    // Fixture ZZ: vendor 3y dormancy, cutoff Jun 30, report+remit Nov 1, DD window 60-120 days before.
    const f = buildForecast([engineItem("1", simpleFile())], { asOf: ASOF });
    const byMonth = Object.fromEntries(f.months.filter((m) => m.events.length).map((m) => [m.month, m.events.map((e) => `${e.kind}@${e.date}`)]));
    expect(byMonth).toEqual({
      "2027-03": ["presumed_abandoned@2027-03-15"],
      "2027-07": ["dd_window_opens@2027-07-04"],
      "2027-11": ["report_due@2027-11-01", "remit_due@2027-11-01"],
    });
    const mar = f.months.find((m) => m.month === "2027-03")!;
    expect(mar.byState).toEqual([expect.objectContaining({ state: "ZZ", presumedCount: 1, presumedCents: 100_000 })]);
    const nov = f.months.find((m) => m.month === "2027-11")!;
    expect(nov.remitCents).toBe(100_000);
    expect(nov.byState[0]!.reportDue).toEqual([{ date: "2027-11-01", stage: "annual", count: 1 }]);
    expect(f.totals).toMatchObject({ presumedCents: 100_000, presumedCount: 1, remitCents: 100_000, remitCount: 1, events: 4 });
  });

  it("emits one report_due per stage for a two-stage state", () => {
    const f = buildForecast([engineItem("1", twoStageFile())], { asOf: ASOF, horizonMonths: 24 });
    const reports = f.months.flatMap((m) => m.events).filter((e) => e.kind === "report_due");
    expect(reports.map((e) => [e.stage, e.date])).toEqual([
      ["notice", "2027-11-01"],
      ["report", "2028-03-01"],
    ]);
  });

  it("sums several items and states per month and stays sorted", () => {
    const f = buildForecast(
      [fixedItem("b", { presumed: "2027-01-20" }, "ZY"), fixedItem("a", { presumed: "2027-01-05" }), fixedItem("c", { presumed: "2027-01-31" })],
      { asOf: ASOF },
    );
    const jan = f.months.find((m) => m.month === "2027-01")!;
    expect(jan.events.map((e) => e.itemId)).toEqual(["a", "b", "c"]);
    expect(jan.byState.map((c) => [c.state, c.presumedCount, c.presumedCents])).toEqual([
      ["ZY", 1, 1_000],
      ["ZZ", 2, 2_000],
    ]);
    expect(f.states).toEqual(["ZY", "ZZ"]);
  });
});

describe("horizon edges", () => {
  const f = buildForecast(
    [
      fixedItem("before", { presumed: "2026-10-31" }),
      fixedItem("today", { presumed: "2026-11-01" }),
      fixedItem("last", { presumed: "2028-04-30" }),
      fixedItem("end", { presumed: "2028-05-01" }),
    ],
    { asOf: ASOF, horizonMonths: 18 },
  );
  const ids = f.months.flatMap((m) => m.events.map((e) => e.itemId));

  it("includes today and the last day of the last month", () => {
    expect(ids).toEqual(["today", "last"]);
  });
  it("excludes the past and the exclusive end date", () => {
    expect(ids).not.toContain("before");
    expect(ids).not.toContain("end");
  });
  it("a 1-month horizon covers only the current month", () => {
    const one = buildForecast([fixedItem("x", { presumed: "2026-11-30" }), fixedItem("y", { presumed: "2026-12-01" })], { asOf: ASOF, horizonMonths: 1 });
    expect(one.months).toHaveLength(1);
    expect(one.windowEnd).toBe("2026-12-01");
    expect(one.months[0]!.events.map((e) => e.itemId)).toEqual(["x"]);
  });
  it("rejects an out-of-range horizon; clampHorizon coerces untrusted input", () => {
    expect(() => buildForecast([], { asOf: ASOF, horizonMonths: 0 })).toThrow(RangeError);
    expect(() => buildForecast([], { asOf: ASOF, horizonMonths: 25 })).toThrow(RangeError);
    expect(() => buildForecast([], { asOf: ASOF, horizonMonths: 1.5 })).toThrow(RangeError);
    expect(clampHorizon("12")).toBe(12);
    expect(clampHorizon(99)).toBe(24);
    expect(clampHorizon(-3)).toBe(1);
    expect(clampHorizon("abc")).toBe(DEFAULT_HORIZON_MONTHS);
    expect(clampHorizon(undefined)).toBe(DEFAULT_HORIZON_MONTHS);
  });
});

describe("leap year and month ends", () => {
  it("February has 29 days in a leap year and 28 otherwise", () => {
    expect(monthBuckets(d("2028-01-31"), 2).buckets[1]).toEqual({ month: "2028-02", from: "2028-02-01", to: "2028-02-29" });
    expect(monthBuckets(d("2027-01-31"), 2).buckets[1]).toEqual({ month: "2027-02", from: "2027-02-01", to: "2027-02-28" });
    expect(monthBuckets(d("2026-01-31"), 3).buckets.map((b) => b.to)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
  });

  it("a Feb 29 presumed-abandoned date from the engine lands in February", () => {
    const base = simpleFile();
    const fourYear = simpleFile({ propertyTypes: { ...base.propertyTypes, vendor_check: { ...base.propertyTypes.vendor_check!, dormancyYears: rv(4) } } });
    const f = buildForecast([engineItem("leap", fourYear, { lastActivity: "2024-02-29" })], { asOf: d("2027-12-15"), horizonMonths: 3 });
    const feb = f.months.find((m) => m.month === "2028-02")!;
    expect(feb.events.map((e) => `${e.kind}@${e.date}`)).toEqual(["presumed_abandoned@2028-02-29"]);
    expect(f.windowEnd).toBe("2028-03-01");
  });

  it("an event on the 31st stays in its own month", () => {
    const f = buildForecast([fixedItem("eom", { report: "2027-01-31", remit: "2027-02-01" })], { asOf: ASOF });
    expect(f.months.find((m) => m.month === "2027-01")!.counts.report_due).toBe(1);
    expect(f.months.find((m) => m.month === "2027-02")!.counts.remit_due).toBe(1);
  });
});

describe("UNKNOWN bucket (rule missing)", () => {
  it("a null dormancy puts the item in UNKNOWN with every kind missing and no guessed month", () => {
    const base = simpleFile();
    const noDormancy = simpleFile({ propertyTypes: { ...base.propertyTypes, vendor_check: { ...base.propertyTypes.vendor_check!, dormancyYears: rv<number>(null, false) } } });
    const f = buildForecast([engineItem("u", noDormancy, { cents: 43_210 })], { asOf: ASOF });
    expect(f.totals.events).toBe(0);
    expect(f.months.every((m) => m.events.length === 0)).toBe(true);
    expect(f.unknown.count).toBe(1);
    expect(f.unknown.cents).toBe(43_210);
    const u = f.unknown.items[0]!;
    expect(u.missing).toEqual(["presumed_abandoned", "dd_window_opens", "report_due", "remit_due"]);
    expect(u.rulePaths).toContain("ZZ@test-v1:propertyTypes.vendor_check.dormancyYears");
    expect(u.reasons.join(" ")).toMatch(/Dormancy period/);
  });

  it("a missing DD window rule lists only that kind; computed dates still forecast", () => {
    const base = simpleFile();
    const noWindow = simpleFile({ dueDiligence: { ...base.dueDiligence, windowDaysBeforeReport: rv<{ min: number; max: number | null }>(null, false) } });
    const f = buildForecast([engineItem("w", noWindow)], { asOf: ASOF });
    expect(f.unknown.items.map((u) => u.missing)).toEqual([["dd_window_opens"]]);
    expect(f.months.flatMap((m) => m.events).map((e) => e.kind)).toEqual(["presumed_abandoned", "report_due", "remit_due"]);
  });

  it("an item with no rule file or no owner state is UNKNOWN, never bucketed", () => {
    const f = buildForecast(
      [
        { itemId: "ny", checkNumber: "1", payeeName: "NY payee", state: "NY", amountCents: 500, timeline: null, noTimelineReason: "No rule file for NY" },
        { itemId: "none", checkNumber: "2", payeeName: "Nowhere", state: null, amountCents: 700, timeline: null },
      ],
      { asOf: ASOF },
    );
    expect(f.totals.events).toBe(0);
    expect(f.unknown).toMatchObject({ count: 2, cents: 1_200 });
    expect(f.unknown.items.map((u) => [u.itemId, u.reasons[0]])).toEqual([
      ["ny", "No rule file for NY"],
      ["none", "Owner state could not be determined"],
    ]);
  });

  it("not_applicable (below the DD minimum) is not unknown", () => {
    const f = buildForecast([engineItem("small", simpleFile(), { cents: 1_000 })], { asOf: ASOF });
    expect(f.unknown.count).toBe(0);
    expect(f.months.flatMap((m) => m.events).some((e) => e.kind === "dd_window_opens")).toBe(false);
  });
});

describe("unverified propagation", () => {
  it("per-date verified flags come from the engine and roll up to cells, months and totals", () => {
    // Unverified business-day roll affects due dates (report, remit, DD) but not the presumed-abandoned date.
    const f = buildForecast([engineItem("v", simpleFile({ businessDayRollForward: rv<boolean>(true, false) }))], { asOf: ASOF });
    const events = f.months.flatMap((m) => m.events);
    expect(Object.fromEntries(events.map((e) => [e.kind, e.verified]))).toEqual({
      presumed_abandoned: true,
      dd_window_opens: false,
      report_due: false,
      remit_due: false,
    });
    expect(f.months.find((m) => m.month === "2027-03")!.anyUnverified).toBe(false);
    const nov = f.months.find((m) => m.month === "2027-11")!;
    expect(nov.anyUnverified).toBe(true);
    expect(nov.byState[0]!.unverified).toBe(true);
    expect(f.totals.unverifiedEvents).toBe(3);
  });

  it("an unverified dormancy marks the presumed date unverified", () => {
    const base = simpleFile();
    const file = simpleFile({ propertyTypes: { ...base.propertyTypes, vendor_check: { ...base.propertyTypes.vendor_check!, dormancyYears: rv(3, false) } } });
    const events = buildForecast([engineItem("p", file)], { asOf: ASOF }).months.flatMap((m) => m.events);
    expect(events.every((e) => !e.verified)).toBe(true);
  });

  it("fully verified fixture yields no unverified events", () => {
    expect(buildForecast([engineItem("ok", simpleFile())], { asOf: ASOF }).totals.unverifiedEvents).toBe(0);
  });
});

describe("filters and determinism", () => {
  const items = [engineItem("z1", simpleFile()), engineItem("y1", twoStageFile()), engineItem("z2", simpleFile(), { lastActivity: "2024-05-01", cents: 2_500 })];

  it("state filter is case-insensitive and drops other states (including unknown-state items)", () => {
    const withUnknown = [...items, { itemId: "n", checkNumber: null, payeeName: "n", state: null, amountCents: 1, timeline: null }];
    const f = buildForecast(withUnknown, { asOf: ASOF, states: ["zz"] });
    expect(f.states).toEqual(["ZZ"]);
    expect(f.itemCount).toBe(2);
    expect(new Set(f.months.flatMap((m) => m.events.map((e) => e.state)))).toEqual(new Set(["ZZ"]));
    expect(f.unknown.count).toBe(0);
  });

  it("same inputs in any order give identical output", () => {
    const a = buildForecast(items, { asOf: ASOF });
    const b = buildForecast([...items].reverse(), { asOf: ASOF });
    expect(b).toEqual(a);
  });

  it("money stays integer cents", () => {
    expect(() => buildForecast([{ ...items[0]!, amountCents: 10.5 }], { asOf: ASOF })).toThrow(RangeError);
  });
});

describe("calendarDeadlines", () => {
  it("aggregates per date, kind, state and stage; skips presumed-abandoned; ANDs verified", () => {
    const unverifiedRoll = simpleFile({ businessDayRollForward: rv<boolean>(true, false) });
    const f = buildForecast([engineItem("a", simpleFile()), engineItem("b", simpleFile(), { cents: 50_000 }), engineItem("c", unverifiedRoll, { lastActivity: "2024-04-01" })], {
      asOf: ASOF,
    });
    const cal = calendarDeadlines(f);
    expect(cal.some((c) => (c.kind as string) === "presumed_abandoned")).toBe(false);
    const report = cal.find((c) => c.kind === "report_due" && c.date === "2027-11-01")!;
    expect(report).toMatchObject({ state: "ZZ", stage: "annual", count: 3, cents: 250_000, verified: false });
  });
});
