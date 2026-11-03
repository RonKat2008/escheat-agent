import { Money, UnverifiedBadge } from "@/components/primitives";
import { InstrumentLabel } from "@/components/primitives/v3";
import { diffDays, type IsoDate } from "@/lib/dates";
import { formatDate } from "@/lib/format";
import { calendarDeadlines, FORECAST_EVENT_LABEL, type Forecast } from "@/lib/forecast/compute";
import { cn } from "@/lib/utils";
import { AddToCalendar } from "./AddToCalendar";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthName = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;
const KIND_ORDER = { dd_window_opens: 0, report_due: 1, remit_due: 2 } as const;

function untilLabel(days: number): string {
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}

/**
 * The filing calendar (§6.7): every DD window opening, report and remit due date in the forecast window, one row per
 * date, kind, state and stage, grouped by month. "In N days" counts from the demo clock, not the wall clock. Rows within
 * 7 days carry the pink marker; every row resting on an unverified rule carries its own UNVERIFIED badge.
 */
export function CalendarList({ forecast, state, horizon }: { forecast: Forecast; state?: string | null; horizon?: number | null }) {
  const rows = calendarDeadlines(forecast).sort(
    (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.state.localeCompare(b.state) || (a.stage ?? "").localeCompare(b.stage ?? ""),
  );
  const months = [...new Set(rows.map((r) => r.date.slice(0, 7)))];

  return (
    <section aria-labelledby="calendar-h" className="min-w-0 border-t border-line pt-5" data-testid="calendar-list">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
          <h2 id="calendar-h" className="text-[15px] font-medium text-fg-1">
            Filing calendar
          </h2>
          <span className="text-xs text-fg-3">
            {plural(rows.length, "date")}, counted from {formatDate(forecast.asOf)} (demo clock)
          </span>
        </div>
        <AddToCalendar state={state} horizon={horizon} size="sm" />
      </div>
      {rows.length === 0 ? (
        <p className="text-[13px] text-fg-2">No filing dates in this window. Due-diligence openings and report and remit due dates appear here as the engine computes them.</p>
      ) : (
        <div className="space-y-5">
          {months.map((m) => (
            <div key={m}>
              <InstrumentLabel as="h3" className="mb-1.5 block">
                {monthName(m)}
              </InstrumentLabel>
              <ul className="divide-y divide-line border-y border-line">
                {rows
                  .filter((r) => r.date.startsWith(m))
                  .map((r) => {
                    const days = diffDays(forecast.asOf, r.date as IsoDate);
                    const urgent = days <= 7;
                    return (
                      <li
                        key={`${r.date}-${r.kind}-${r.state}-${r.stage ?? ""}`}
                        data-testid="calendar-row"
                        data-urgent={urgent || undefined}
                        className="grid grid-cols-[72px_minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-0.5 py-2 text-[13px] sm:grid-cols-[96px_minmax(0,1fr)_120px_auto]"
                      >
                        <span className="num font-medium whitespace-nowrap text-fg-1">{formatDate(r.date, { year: false })}</span>
                        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-fg-2">
                          <span className="text-fg-1">{FORECAST_EVENT_LABEL[r.kind]}</span>
                          <span className="num">{r.state}</span>
                          {r.stage ? <span className="text-fg-3">{r.stage}</span> : null}
                          <span className="text-xs text-fg-3">{plural(r.count, "item")}</span>
                          {r.verified ? null : <UnverifiedBadge compact />}
                        </span>
                        <span className={cn("num text-right text-xs whitespace-nowrap max-sm:col-start-3 max-sm:row-start-1", urgent ? "text-pink-400" : "text-fg-3")}>
                          {urgent ? (
                            <span aria-hidden className="mr-1.5 inline-block size-1.5 rounded-full bg-pink-500 align-middle" />
                          ) : null}
                          {untilLabel(days)}
                        </span>
                        <Money cents={r.cents} className="text-right text-fg-1 max-sm:col-start-2 max-sm:text-left max-sm:text-xs" />
                      </li>
                    );
                  })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
