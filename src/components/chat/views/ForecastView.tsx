"use client";

import { plural } from "@/lib/plural";
import { CalendarRange } from "lucide-react";
import { Money } from "@/components/primitives";
import { calendarHref } from "@/components/forecast/AddToCalendar";
import type { ForecastUi } from "@/lib/chat/ui-types";
import { fmtDate, FooterLink, UnknownFlag, UnverifiedFlag, usd, ViewCard } from "./parts";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
/** Same fixed per-state series as the /forecast chart. */
const STATE_FILL: Record<string, string> = { CA: "var(--chat-blue-500)", TX: "var(--chat-blue-300)", DE: "rgb(255 255 255 / 0.55)" };
const fill = (s: string) => STATE_FILL[s] ?? "rgb(255 255 255 / 0.3)";
const KIND_LABEL: Record<string, string> = {
  presumed_abandoned: "presumed abandoned",
  dd_window_opens: "DD opens",
  report_due: "report due",
  remit_due: "remit due",
};

/** Monthly stacked columns (CSS, static: paints complete on first render) of the amount becoming presumed abandoned. */
function MiniBars({ months, states }: { months: ForecastUi["props"]["months"]; states: string[] }) {
  const max = Math.max(1, ...months.map((m) => m.presumedCents));
  return (
    <div className="px-4 pt-3 pb-2">
      <div className="flex h-24 items-end gap-[3px]" aria-hidden>
        {months.map((m) => (
          <div key={m.month} className="flex h-full min-w-0 flex-1 flex-col-reverse" title={`${monthLabel(m.month)}: ${usd(m.presumedCents)}`}>
            {m.presumedCents === 0 ? (
              <div className="h-px w-full bg-[var(--chat-line-strong)]" />
            ) : (
              m.byState
                .filter((c) => c.presumedCents > 0)
                .map((c) => <div key={c.state} className="w-full first:rounded-b-none last:rounded-t-[2px]" style={{ height: `${(c.presumedCents / max) * 100}%`, background: fill(c.state) }} />)
            )}
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] text-[var(--chat-t3)] tabular-nums">
        <span>{monthLabel(months[0]!.month)}</span>
        <span>{monthLabel(months.at(-1)!.month)}</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--chat-t2)]">
        {states.map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5">
            <span aria-hidden className="size-2 rounded-[2px]" style={{ background: fill(s) }} />
            {s}
          </span>
        ))}
      </div>
    </div>
  );
}

export function ForecastView({ asOf, horizonMonths, state, states, months, totals, unknown }: ForecastUi["props"]) {
  const active = months.filter((m) => m.presumedCount + m.remitCount + m.ddOpenCount + m.reportDueCount > 0);
  const peak = active.reduce<(typeof months)[number] | null>((best, m) => (!best || m.presumedCents > best.presumedCents ? m : best), null);
  const page = `/forecast${state ? `?state=${state}` : ""}`;
  return (
    <ViewCard
      testId="view-forecast"
      icon={<CalendarRange />}
      title={`${horizonMonths}-month forecast${state ? ` for ${state}` : ""}`}
      meta={`from ${fmtDate(asOf)}`}
      footer={
        <>
          {totals.unverifiedEvents > 0 ? (
            <span className="flex items-center gap-1.5 text-xs text-[var(--chat-t3)]">
              <UnverifiedFlag compact />
              {totals.unverifiedEvents} dates rest on unverified rules
            </span>
          ) : null}
          <span className="flex-1" />
          <FooterLink href={calendarHref({ state, horizon: horizonMonths })}>Add to calendar</FooterLink>
          <FooterLink href={page}>Forecast</FooterLink>
        </>
      }
    >
      <dl className="grid grid-cols-2 gap-4 px-4 pt-4" role="group" aria-label="Forecast totals">
        <div className="min-w-0">
          <dt className="text-xs text-[var(--chat-t3)]">Becoming presumed abandoned</dt>
          <dd className="mt-0.5 text-lg font-semibold text-[var(--chat-t1)]" data-testid="forecast-presumed-total">
            <Money cents={totals.presumedCents} wholeDollars />
          </dd>
          <dd className="text-xs text-[var(--chat-t3)] tabular-nums">{plural(totals.presumedCount, "item")}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-[var(--chat-t3)]">Due to remit</dt>
          <dd className="mt-0.5 text-lg font-semibold text-[var(--chat-t1)]">
            <Money cents={totals.remitCents} wholeDollars />
          </dd>
          <dd className="text-xs text-[var(--chat-t3)] tabular-nums">{plural(totals.remitCount, "item")}</dd>
        </div>
      </dl>
      {months.length > 0 ? <MiniBars months={months} states={states} /> : null}
      {peak && peak.presumedCents > 0 ? (
        <p className="px-4 pb-3 text-xs text-[var(--chat-t3)]">
          Largest month: {monthLabel(peak.month)}, {usd(peak.presumedCents)}.
        </p>
      ) : null}
      <div className="border-t border-[var(--chat-line)] px-4 py-3" data-testid="forecast-unknown">
        {unknown.count === 0 ? (
          <p className="text-xs text-[var(--chat-t3)]">No item is missing a rule: every date in this window was computed.</p>
        ) : (
          <>
            <p className="flex flex-wrap items-center gap-2 text-[13px] text-[var(--chat-t1)]">
              <UnknownFlag />
              {unknown.count} {unknown.count === 1 ? "item" : "items"}, {usd(unknown.cents)}: rule missing, not placed in any month
            </p>
            <ul className="mt-1.5 space-y-0.5 text-xs text-[var(--chat-t3)]">
              {unknown.items.slice(0, 5).map((u) => (
                <li key={u.itemId} className="truncate">
                  {u.payeeName}
                  {u.checkNumber ? ` #${u.checkNumber}` : ""}, {u.state ?? "state unknown"}: {u.missing.map((k) => KIND_LABEL[k] ?? k).join(", ")}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </ViewCard>
  );
}
