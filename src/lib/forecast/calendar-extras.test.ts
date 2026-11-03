import { describe, expect, it } from "vitest";
import type { IsoDate } from "@/lib/dates";
import type { DatedValue, Timeline } from "@/lib/rules/engine";
import { forecastToIcs } from "./calendar";
import { buildForecast, calendarExtras, type ForecastItemInput } from "./compute";
import { CRLF } from "./ics";

const d = (s: string) => s as IsoDate;
const ASOF = d("2026-11-01");
const ok = (date: string, verified = true): DatedValue => ({ date: d(date), status: "ok", verified, ruleRefs: [], sources: [], notes: [] });
const na = (): DatedValue => ({ date: null, status: "not_applicable", verified: true, ruleRefs: [], sources: [], notes: [] });
const unknown = (): DatedValue => ({ date: null, status: "unknown", verified: false, ruleRefs: [], sources: [], notes: ["missing"] });

function item(id: string, dates: { ddStart?: string; ddEnd?: DatedValue; report?: string; remit?: string }, state = "ZZ"): ForecastItemInput {
  const v = (x?: string) => (x ? ok(x) : na());
  const timeline: Timeline = {
    state,
    propertyType: "vendor_check",
    rules: { state, version: "test" },
    presumedAbandoned: na(),
    ddApplies: true,
    ddWindow: { start: v(dates.ddStart), end: dates.ddEnd ?? na() },
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

describe("calendarExtras", () => {
  it("emits DD window closes within the horizon, aggregated, using the engine date verbatim", () => {
    const x = calendarExtras([item("a", { ddEnd: ok("2027-03-05") }), item("b", { ddEnd: ok("2027-03-05") })], { asOf: ASOF });
    expect(x).toEqual([{ kind: "dd_window_closes", date: "2027-03-05", state: "ZZ", stage: null, count: 2, cents: 2_000, verified: true }]);
  });

  it("skips closes beyond the horizon, unknown or not-applicable dates", () => {
    const x = calendarExtras(
      [item("far", { ddEnd: ok("2030-01-01") }), item("unk", { ddEnd: unknown() }), item("na", {})],
      { asOf: ASOF, horizonMonths: 6 },
    );
    expect(x).toEqual([]);
  });

  it("marks past report, remit and DD close dates as overdue", () => {
    const x = calendarExtras([item("late", { ddEnd: ok("2026-09-01"), report: "2026-10-01", remit: "2026-10-15" })], { asOf: ASOF });
    expect(x.map((e) => [e.kind, e.date])).toEqual([
      ["overdue_dd_window_closes", "2026-09-01"],
      ["overdue_report_due", "2026-10-01"],
      ["overdue_remit_due", "2026-10-15"],
    ]);
  });

  it("uses the item status via the shared overdue function: met obligations and unknown dates are never overdue", () => {
    const late = item("late", { ddEnd: ok("2026-09-01"), report: "2026-10-01", remit: "2026-10-15" });
    expect(calendarExtras([{ ...late, status: "reported" }], { asOf: ASOF })).toEqual([]);
    // Letter sent: the DD close is met, the report and remittance are still late.
    expect(calendarExtras([{ ...late, status: "dd_sent" }], { asOf: ASOF }).map((e) => e.kind)).toEqual(["overdue_report_due", "overdue_remit_due"]);
    const unk = item("unk", { ddEnd: unknown() });
    expect(calendarExtras([{ ...unk, timeline: { ...unk.timeline!, remitDue: unknown() } }], { asOf: ASOF })).toEqual([]);
  });

  it("does not repeat upcoming report/remit dates (the forecast already has them)", () => {
    expect(calendarExtras([item("future", { report: "2027-05-01", remit: "2027-06-01" })], { asOf: ASOF })).toEqual([]);
  });

  it("treats a date equal to asOf as upcoming, not overdue", () => {
    const x = calendarExtras([item("today", { ddEnd: ok("2026-11-01") })], { asOf: ASOF });
    expect(x[0]?.kind).toBe("dd_window_closes");
  });

  it("honours the state filter and carries the unverified flag", () => {
    const items = [item("z", { ddEnd: ok("2027-01-10") }, "ZZ"), item("y", { ddEnd: { ...ok("2027-01-10"), verified: false } }, "YY")];
    expect(calendarExtras(items, { asOf: ASOF, states: ["yy"] })).toEqual([
      { kind: "dd_window_closes", date: "2027-01-10", state: "YY", stage: null, count: 1, cents: 1_000, verified: false },
    ]);
  });
});

describe("forecastToIcs with extras", () => {
  const opts = { companyId: "11111111-2222-4333-8444-555555555555", companyName: "Northwind" };
  const items = [item("a", { ddStart: "2026-12-01", ddEnd: ok("2027-02-01"), report: "2026-10-01", remit: "2027-05-01" })];
  const forecast = buildForecast(items, { asOf: ASOF });
  const ics = forecastToIcs(forecast, { ...opts, extras: calendarExtras(items, { asOf: ASOF }) });
  const unfolded = ics.replace(/\r\n /g, "");

  it("adds a DD close event and a clearly marked OVERDUE event", () => {
    expect(unfolded).toContain("SUMMARY:ZZ due-diligence window closes (send letters by this date): 1 item\\, $10.00");
    expect(unfolded).toContain("SUMMARY:OVERDUE: ZZ report was due (annual stage): 1 item\\, $10.00");
    expect(unfolded).toContain("CATEGORIES:Unclaimed property,ZZ,OVERDUE");
  });

  it("gives every event exactly one VALARM, 7 days ahead for upcoming dates", () => {
    const events = unfolded.split("BEGIN:VEVENT").slice(1);
    expect(events.length).toBeGreaterThanOrEqual(4);
    for (const e of events) expect(e.match(/BEGIN:VALARM/g)).toHaveLength(1);
    expect(unfolded).toContain(`TRIGGER:-P7D${CRLF}`);
    expect(unfolded).toContain(`ACTION:DISPLAY${CRLF}`);
  });

  it("is unchanged in structure when no extras are passed", () => {
    const plain = forecastToIcs(forecast, opts);
    expect(plain).not.toContain("OVERDUE");
    expect(plain).not.toContain("window closes");
  });
});
