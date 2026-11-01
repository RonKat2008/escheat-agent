import { Section, UnverifiedBanner } from "@/components/primitives";
import { AddToCalendar } from "@/components/forecast/AddToCalendar";
import { formatDate } from "@/lib/format";
import type { Forecast } from "@/lib/forecast/compute";
import { formatUSD } from "@/lib/money";
import { getForecast } from "@/lib/queries";
import { getCtx } from "@/lib/ui/ctx";
import { ForecastChart, type ChartMonth } from "./chart";
import { ForecastRegion } from "./interactions";
import { BasisToggle, ForecastFilters } from "./filters";
import { loadForecastParams, type Basis } from "./params";
import { ForecastStats, ForecastTable, monthLabel, UnknownBucket } from "./sections";

function chartMonths(f: Forecast, basis: Basis): ChartMonth[] {
  return f.months.map((m) => ({
    month: m.month,
    label: monthLabel(m.month, m.month.endsWith("-01") || m === f.months[0]),
    cents: Object.fromEntries(m.byState.map((c) => [c.state, basis === "presumed" ? c.presumedCents : c.remitCents])),
    counts: Object.fromEntries(m.byState.map((c) => [c.state, basis === "presumed" ? c.presumedCount : c.remitCount])),
    unverified: m.byState.some((c) => c.unverified && (basis === "presumed" ? c.presumedCount : c.remitCount) > 0),
  }));
}

function chartSummary(f: Forecast, basis: Basis, months: ChartMonth[]): string {
  const totals = months.map((m) => ({ m, cents: Object.values(m.cents).reduce((a, c) => a + c, 0) }));
  const peak = totals.reduce((best, t) => (t.cents > best.cents ? t : best), totals[0]!);
  const total = basis === "presumed" ? f.totals.presumedCents : f.totals.remitCents;
  const what = basis === "presumed" ? "becoming presumed abandoned" : "due to remit";
  return total === 0
    ? `No amounts ${what} in the next ${f.horizonMonths} months.`
    : `${formatUSD(total)} ${what} over ${f.horizonMonths} months, stacked by state; the largest month is ${monthLabel(peak.m.month)} at ${formatUSD(peak.cents)}.`;
}

export async function ForecastData({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const p = loadForecastParams(await searchParams);
  const { db, companyId } = await getCtx();
  const forecast = await getForecast(db, companyId, { horizonMonths: p.horizon, states: p.state ? [p.state] : undefined });
  const months = chartMonths(forecast, p.basis);
  const states = forecast.states.length > 0 ? forecast.states : p.state ? [p.state] : [];
  const lastDay = formatDate(forecast.months.at(-1)!.to);

  return (
    <ForecastRegion className="space-y-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ForecastFilters />
        <AddToCalendar state={p.state} horizon={p.horizon} />
      </div>
      <p className="-mt-6 text-[13px] text-fg-3" data-testid="forecast-window">
        From {formatDate(forecast.asOf)} (demo clock) through {lastDay}. Covers the {forecast.itemCount} open items in the pipeline; payments not yet stale
        are not projected.
      </p>
      {forecast.totals.unverifiedEvents > 0 ? <UnverifiedBanner /> : null}
      <div data-dim className="space-y-10">
      <ForecastStats forecast={forecast} />
      <Section
        title="Projected liability by month"
        meta={p.basis === "presumed" ? "amount becoming presumed abandoned" : "amount due to remit"}
        id="forecast-chart"
        action={<BasisToggle />}
        className="[&>div:first-child]:flex-wrap"
      >
        <ForecastChart months={months} states={states} summary={chartSummary(forecast, p.basis, months)} />
      </Section>
      <ForecastTable forecast={forecast} />
      <UnknownBucket forecast={forecast} />
      </div>
    </ForecastRegion>
  );
}
