import { describe, expect, it } from "vitest";
import type { IsoDate } from "@/lib/dates";
import type { DatedValue, Timeline } from "@/lib/rules/engine";
import { buildForecast, calendarExtras, type ForecastItemInput } from "./compute";

const d = (s: string) => s as IsoDate;
const ASOF = d("2026-11-01");
const ok = (date: string): DatedValue => ({ date: d(date), status: "ok", verified: true, ruleRefs: [], sources: [], notes: [] });
const na = (): DatedValue => ({ date: null, status: "not_applicable", verified: true, ruleRefs: [], sources: [], notes: [] });

function item(id: string, dates: { ddStart?: string; ddEnd?: string; report?: string; remit?: string }, status?: ForecastItemInput["status"]): ForecastItemInput {
  const v = (x?: string) => (x ? ok(x) : na());
  const timeline: Timeline = {
    state: "ZZ",
    propertyType: "vendor_check",
    rules: { state: "ZZ", version: "test" },
    presumedAbandoned: na(),
    ddApplies: true,
    ddWindow: { start: v(dates.ddStart), end: v(dates.ddEnd) },
    reportStages: [{ name: "annual", asOf: na(), due: v(dates.report), includesRemittance: true }],
    remitDue: v(dates.remit),
    minAmountApplies: false,
    aggregate: false,
    anyUnverified: false,
    anyUnknown: false,
    warnings: [],
  };
  return { itemId: id, checkNumber: id, payeeName: id, state: "ZZ", amountCents: 1_000, timeline, status };
}

const kinds = (items: ForecastItemInput[]) =>
  buildForecast(items, { asOf: ASOF })
    .months.flatMap((m) => m.events)
    .map((e) => e.kind);

describe("satisfied obligations drop out of the forecast and the .ics (R3-17)", () => {
  const filed = () => item("filed", { ddStart: "2026-11-10", ddEnd: "2026-11-20", report: "2026-11-02", remit: "2026-12-15" }, "reported");

  it("a reported item keeps only its remittance in the forecast events", () => {
    expect(kinds([filed()])).toEqual(["remit_due"]);
  });

  it("a reported item contributes no DD close or report extras, and its past report date is not overdue", () => {
    const past = item("p", { ddEnd: "2026-09-01", report: "2026-10-01" }, "reported");
    expect(calendarExtras([filed(), past], { asOf: ASOF })).toEqual([]);
  });

  it("a reported item whose remittance date has passed is an overdue remittance in the calendar", () => {
    const late = item("r", { report: "2026-09-01", remit: "2026-10-15" }, "reported");
    expect(calendarExtras([late], { asOf: ASOF }).map((e) => e.kind)).toEqual(["overdue_remit_due"]);
  });

  it("an item with no status still shows every event", () => {
    const open = item("open", { ddStart: "2026-11-10", report: "2026-11-02", remit: "2026-12-15" });
    expect(kinds([open])).toEqual(["report_due", "dd_window_opens", "remit_due"]);
  });
});
