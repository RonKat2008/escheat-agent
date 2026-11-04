/**
 * Read model for the liability forecast: loads open stale items and runs each one through the SAME rules engine
 * call the pipeline uses (rulesFor + computeTimeline, inputs as in recompute.ts), then buckets the dates by month.
 */
import { cache } from "react";
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { companies, ledgerItems, payees, staleItems } from "@/db/schema";
import type { IsoDate } from "@/lib/dates";
import { buildForecast, calendarExtras, clampHorizon, type CalendarExtra, type Forecast, type ForecastItemInput } from "@/lib/forecast/compute";
import { rulesFor } from "@/lib/pipeline/compute";
import { computeTimeline } from "@/lib/rules/engine";
import { openStatusCondition, today } from "./common";

export interface ForecastQuery {
  horizonMonths?: number;
  states?: readonly string[];
}

/**
 * Open items run through the rules engine, once per server render: the forecast and its calendar extras both need it
 * (was computed twice per Forecast page). Per-render scope only, like loadOpenRows; read-only result.
 */
export const loadForecastInputs = cache(async (db: Db, companyId: string): Promise<ForecastItemInput[]> => {
  const [company] = await db.select({ fiscalYearEnd: companies.fiscalYearEnd }).from(companies).where(eq(companies.id, companyId));
  if (!company) throw new Error(`Unknown company ${companyId}`);
  const rows = await db
    .select({
      id: staleItems.id,
      amountCents: staleItems.amountCents,
      status: staleItems.status,
      propertyType: staleItems.propertyType,
      ownerState: staleItems.ownerState,
      lastActivityDate: staleItems.lastActivityDate,
      staleSince: staleItems.staleSince,
      ledgerLastActivity: ledgerItems.lastActivityDate,
      issueDate: ledgerItems.issueDate,
      checkNumber: ledgerItems.referenceNumber,
      payeeNameRaw: ledgerItems.payeeNameRaw,
      payeeName: payees.canonicalName,
    })
    .from(staleItems)
    .innerJoin(ledgerItems, eq(ledgerItems.id, staleItems.ledgerItemId))
    .leftJoin(payees, eq(payees.id, staleItems.ownerPayeeId))
    .where(and(eq(staleItems.companyId, companyId), openStatusCondition()));

  return rows.map((r): ForecastItemInput => {
    const state = r.ownerState?.trim().toUpperCase() || null;
    const rules = rulesFor(state);
    const base = { itemId: r.id, checkNumber: r.checkNumber, payeeName: r.payeeName ?? r.payeeNameRaw, state, amountCents: r.amountCents, status: r.status };
    if (!state || !rules) {
      return {
        ...base,
        timeline: null,
        noTimelineReason: state
          ? `No rule file for ${state}: only CA, DE and TX are supported in this prototype.`
          : "Owner state could not be determined.",
      };
    }
    const lastActivity = (r.lastActivityDate ?? r.ledgerLastActivity ?? r.issueDate ?? r.staleSince) as IsoDate;
    const timeline = computeTimeline(
      { propertyType: r.propertyType, lastActivityDate: lastActivity, amountCents: r.amountCents, ownerState: state, holderFiscalYearEnd: company.fiscalYearEnd },
      rules.file,
    );
    return { ...base, timeline };
  });
});

/** The company's forecast from its simulated today (demo clock aware). */
export async function getForecast(db: Db, companyId: string, q: ForecastQuery = {}): Promise<Forecast> {
  const [asOf, items] = await Promise.all([today(db, companyId), loadForecastInputs(db, companyId)]);
  return buildForecast(items, { asOf, horizonMonths: clampHorizon(q.horizonMonths), states: q.states });
}

/** DD window closes and overdue dates for the calendar feed, from the same engine timelines as the forecast. */
export async function getCalendarExtras(db: Db, companyId: string, q: ForecastQuery = {}): Promise<CalendarExtra[]> {
  const [asOf, items] = await Promise.all([today(db, companyId), loadForecastInputs(db, companyId)]);
  return calendarExtras(items, { asOf, horizonMonths: clampHorizon(q.horizonMonths), states: q.states });
}
