import { describe, expect, it } from "vitest";
import type { IsoDate } from "@/lib/dates";
import { buildForecast, calendarDeadlines, type ForecastItemInput } from "@/lib/forecast/compute";
import { computeTimeline } from "@/lib/rules/engine";
import { tryLoadRules } from "@/lib/rules/load";
import { forecastCounts, windowEvents } from "./forecast-counts";

const ASOF = "2026-11-01" as IsoDate;

function items(): ForecastItemInput[] {
  const out: ForecastItemInput[] = [];
  for (const state of ["CA", "TX", "DE"]) {
    const file = tryLoadRules(state)!.file;
    for (let i = 0; i < 6; i++) {
      const lastActivityDate = `202${3 + (i % 2)}-0${(i % 9) + 1}-15` as IsoDate;
      out.push({
        itemId: `${state}${i}`,
        checkNumber: `${state}${i}`,
        payeeName: `Payee ${state}${i}`,
        state,
        amountCents: 50_000 + i * 1_000,
        timeline: computeTimeline({ propertyType: "vendor_check", lastActivityDate, amountCents: 50_000 + i * 1_000, ownerState: state }, file),
      });
    }
  }
  return out;
}

describe.each([6, 12, 18, 24])("forecast counts at a %i month horizon", (horizonMonths) => {
  it("agree between the totals, the river events and the calendar", () => {
    const f = buildForecast(items(), { asOf: ASOF, horizonMonths });
    const c = forecastCounts(f);
    expect(c.presumedItems).toBe(f.totals.presumedCount);
    expect(c.deadlineEvents).toBe(f.months.reduce((a, m) => a + m.counts.dd_window_opens + m.counts.report_due + m.counts.remit_due, 0));
    expect(c.deadlineEvents).toBe(calendarDeadlines(f).reduce((a, r) => a + r.count, 0));
    expect(c.calendarDates).toBeLessThanOrEqual(c.deadlineEvents);
    // The river draws every event of the whole window: its legend is these same numbers.
    expect(windowEvents(f)).toHaveLength(c.presumedItems + c.deadlineEvents);
    expect(f.months).toHaveLength(horizonMonths);
  });
});
