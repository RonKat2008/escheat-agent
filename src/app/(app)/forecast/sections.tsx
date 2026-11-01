import Link from "next/link";
import { Money, Section, UnknownBadge, UnverifiedBadge } from "@/components/primitives";
import { formatDate } from "@/lib/format";
import { FORECAST_EVENT_LABEL, type Forecast, type ForecastMonth, type ForecastStateCell } from "@/lib/forecast/compute";
import { cn } from "@/lib/utils";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const monthLabel = (ym: string, year = true) => `${MONTHS[Number(ym.slice(5, 7)) - 1]}${year ? ` ${ym.slice(0, 4)}` : ""}`;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Hairline-separated stat strip (no tiles). */
export function ForecastStats({ forecast }: { forecast: Forecast }) {
  const { totals, unknown } = forecast;
  const deadlines = forecast.months.reduce((a, m) => a + m.counts.dd_window_opens + m.counts.report_due + m.counts.remit_due, 0);
  const stats = [
    { label: "Becoming presumed abandoned", value: <Money cents={totals.presumedCents} wholeDollars />, sub: plural(totals.presumedCount, "item") },
    { label: "Due to remit in window", value: <Money cents={totals.remitCents} wholeDollars />, sub: plural(totals.remitCount, "item") },
    { label: "Filing deadlines", value: <span className="num">{deadlines}</span>, sub: "DD openings, report and remit dates" },
    {
      label: "Unknown, rule missing",
      value: <span className={cn("num", unknown.count > 0 ? "text-pink-400" : "text-fg-3")}>{unknown.count}</span>,
      sub: unknown.count > 0 ? <Money cents={unknown.cents} /> : "every date computed",
    },
  ];
  return (
    <dl data-testid="forecast-stats" className="grid grid-cols-2 gap-y-6 border-t border-line pt-5 lg:grid-cols-4 lg:divide-x lg:divide-line">
      {stats.map((s) => (
        <div key={s.label} className="min-w-0 pr-4 lg:px-5 lg:first:pl-0">
          <dt className="text-xs text-fg-2">{s.label}</dt>
          <dd className="mt-1 text-xl leading-7 font-semibold tracking-[-0.015em] text-fg-1">{s.value}</dd>
          <dd className="text-xs text-fg-3">{s.sub}</dd>
        </div>
      ))}
    </dl>
  );
}

/** An empty cell: a quiet dash, read as "none". */
function None() {
  return (
    <span className="text-fg-3">
      <span aria-hidden>–</span>
      <span className="sr-only">none</span>
    </span>
  );
}

function Dates({ dates }: { dates: readonly string[] }) {
  if (dates.length === 0) return <None />;
  return <span className="num">{dates.map((d) => formatDate(d, { year: false })).join(", ")}</span>;
}

function CellRow({ month, cell, first, rowSpan }: { month: ForecastMonth; cell: ForecastStateCell; first: boolean; rowSpan: number }) {
  return (
    <tr className="border-b border-line align-top">
      {first ? (
        <th scope="rowgroup" rowSpan={rowSpan} className="py-2.5 pr-4 text-left font-medium whitespace-nowrap text-fg-1">
          {monthLabel(month.month)}
        </th>
      ) : null}
      <td className="py-2.5 pr-4 text-fg-2">
        <span className="inline-flex items-center gap-1.5">
          {cell.state}
          {cell.unverified ? <UnverifiedBadge compact /> : null}
        </span>
      </td>
      <td className="py-2.5 pr-4 text-right whitespace-nowrap">
        {cell.presumedCount > 0 ? (
          <>
            <Money cents={cell.presumedCents} className="text-fg-1" />
            <span className="block text-xs text-fg-3">{plural(cell.presumedCount, "item")}</span>
          </>
        ) : (
          <None />
        )}
      </td>
      <td className="py-2.5 pr-4 text-fg-2">
        {cell.ddOpenCount > 0 ? (
          <>
            <Dates dates={cell.ddOpenDates} />
            <span className="block text-xs text-fg-3">{plural(cell.ddOpenCount, "window")}</span>
          </>
        ) : (
          <Dates dates={[]} />
        )}
      </td>
      <td className="py-2.5 pr-4 text-fg-2">
        {cell.reportDue.length > 0 ? (
          cell.reportDue.map((r) => (
            <span key={`${r.date}-${r.stage}`} className="block whitespace-nowrap">
              <span className="num">{formatDate(r.date, { year: false })}</span>
              <span className="text-xs text-fg-3">
                {" "}
                {r.stage ? `${r.stage}, ` : ""}
                {plural(r.count, "item")}
              </span>
            </span>
          ))
        ) : (
          <Dates dates={[]} />
        )}
      </td>
      <td className="py-2.5 text-right whitespace-nowrap">
        {cell.remitCount > 0 ? (
          <>
            <Money cents={cell.remitCents} className="text-fg-1" />
            <span className="block text-xs text-fg-3">
              <Dates dates={cell.remitDueDates} />
            </span>
          </>
        ) : (
          <Dates dates={[]} />
        )}
      </td>
    </tr>
  );
}

/** Month x state table: the exact numbers behind the chart, plus the deadline dates. */
export function ForecastTable({ forecast }: { forecast: Forecast }) {
  const empty = forecast.months.filter((m) => m.byState.length === 0);
  return (
    <Section title="By month and state" meta={`${monthLabel(forecast.months[0]!.month)} to ${monthLabel(forecast.months.at(-1)!.month)}`} id="forecast-table">
      <div className="relative -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0" tabIndex={0} role="region" aria-label="Forecast table, scrolls horizontally">
        <table data-testid="forecast-table" className="w-full min-w-[720px] border-collapse text-[13px]">
          <caption className="sr-only">
            Per month and owner state: amounts becoming presumed abandoned, due-diligence windows opening, report due dates and remittances due.
          </caption>
          <thead>
            <tr className="border-b border-line text-left text-xs text-fg-3">
              <th scope="col" className="pb-2 pr-4 font-normal">Month</th>
              <th scope="col" className="pb-2 pr-4 font-normal">State</th>
              <th scope="col" className="pb-2 pr-4 text-right font-normal">{FORECAST_EVENT_LABEL.presumed_abandoned}</th>
              <th scope="col" className="pb-2 pr-4 font-normal">{FORECAST_EVENT_LABEL.dd_window_opens}</th>
              <th scope="col" className="pb-2 pr-4 font-normal">{FORECAST_EVENT_LABEL.report_due}</th>
              <th scope="col" className="pb-2 text-right font-normal">{FORECAST_EVENT_LABEL.remit_due}</th>
            </tr>
          </thead>
          {forecast.months
            .filter((m) => m.byState.length > 0)
            .map((m) => (
              <tbody key={m.month} data-month={m.month}>
                {m.byState.map((cell, i) => (
                  <CellRow key={cell.state} month={m} cell={cell} first={i === 0} rowSpan={m.byState.length} />
                ))}
              </tbody>
            ))}
        </table>
      </div>
      {empty.length > 0 ? (
        <p className="mt-3 text-[13px] text-fg-3">
          No events in {empty.map((m) => monthLabel(m.month)).join(", ")}.
        </p>
      ) : null}
    </Section>
  );
}

/** The explicit UNKNOWN bucket: items whose dates the engine could not compute. Never guessed into a month. */
export function UnknownBucket({ forecast }: { forecast: Forecast }) {
  const { unknown } = forecast;
  return (
    <Section
      title="Unknown, rule missing"
      meta={
        unknown.count > 0 ? (
          <>
            {plural(unknown.count, "item")}, <Money cents={unknown.cents} />
          </>
        ) : (
          "none"
        )
      }
      id="forecast-unknown"
    >
      <div data-testid="unknown-bucket">
        {unknown.count === 0 ? (
          <p className="text-[13px] text-fg-2">
            Every open item in this view has computable dates. Items whose rule value is null or TODO would be listed here, never placed in a month.
          </p>
        ) : (
          <ul className="divide-y divide-line border-y border-line">
            {unknown.items.map((u) => (
              <li key={u.itemId} className="grid gap-x-4 gap-y-1 py-2.5 text-[13px] sm:grid-cols-[minmax(0,1fr)_auto]">
                <div className="min-w-0">
                  <Link href={`/items?item=${u.itemId}`} className="rounded-sm font-medium text-fg-1 hover:text-blue-300">
                    {u.payeeName}
                    {u.checkNumber ? <span className="text-fg-3"> #{u.checkNumber}</span> : null}
                  </Link>
                  <span className="text-fg-3">, {u.state ?? "owner state unknown"}</span>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-fg-2">
                    <UnknownBadge label={`Unknown: ${u.missing.map((k) => FORECAST_EVENT_LABEL[k].toLowerCase()).join(", ")}`} />
                  </p>
                  {u.reasons.length > 0 ? <p className="mt-0.5 text-xs text-fg-3">{u.reasons.join(" ")}</p> : null}
                </div>
                <Money cents={u.amountCents} className="text-fg-1 sm:text-right" />
              </li>
            ))}
          </ul>
        )}
      </div>
    </Section>
  );
}
