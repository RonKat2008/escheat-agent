/**
 * R4-15: the single source for every count on the Forecast page. The KPI strip, the filing calendar and the deadline
 * river all read these, over the SAME window (the whole selected horizon), so "18 mo" can never show a river that
 * stops at month 12 or a legend that disagrees with the headline.
 */
import { calendarDeadlines, type Forecast, type ForecastEvent } from "@/lib/forecast/compute";

export interface ForecastCounts {
  /** Items becoming presumed abandoned in the window (the "Becoming presumed abandoned" KPI and the river legend). */
  presumedItems: number;
  /** DD openings + report due + remit due events: one per item per date (the "Filing deadlines" KPI and river legend). */
  deadlineEvents: number;
  /** Rows in the filing calendar: events that share a date, kind, state and stage are one row. */
  calendarDates: number;
  byKind: { dd_window_opens: number; report_due: number; remit_due: number };
}

/** Every engine event across the whole forecast window, in month order. */
export function windowEvents(f: Forecast): ForecastEvent[] {
  return f.months.flatMap((m) => m.events);
}

export function forecastCounts(f: Forecast): ForecastCounts {
  const byKind = { dd_window_opens: 0, report_due: 0, remit_due: 0 };
  let presumedItems = 0;
  for (const e of windowEvents(f)) {
    if (e.kind === "presumed_abandoned") presumedItems += 1;
    else byKind[e.kind] += 1;
  }
  return {
    presumedItems,
    deadlineEvents: byKind.dd_window_opens + byKind.report_due + byKind.remit_due,
    calendarDates: calendarDeadlines(f).length,
    byKind,
  };
}
