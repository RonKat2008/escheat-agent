import Link from "next/link";
import { ArrowRight, CircleAlert } from "lucide-react";
import { Money, UnknownBadge, UnverifiedBadge } from "@/components/primitives";
import { formatDate, plural } from "@/lib/format";
import { formatUSD } from "@/lib/money";
import { lateLabel, OBLIGATION_LABEL } from "@/lib/overdue";
import type { OverdueSummary } from "@/lib/queries";
import { catchUpHref, type LateMoneySummary } from "@/lib/reports/late-money";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const MAX_ROWS = 3;

/**
 * "$773.74 late · ~$26.07 interest accruing (TX, UNVERIFIED)". The interest is the rules engine's simple interest on the
 * late reports (src/lib/reports/late-money.ts, same engine call as the Audit-interest card). A state with a late report
 * and no interest rule is named as a gap, never given a rate.
 */
function LateMoneyLine({ late }: { late: LateMoneySummary }) {
  const unknown = late.unknownInterestStates;
  return (
    <p id="late-money" data-testid="late-money" className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-fg-1">
      <span>
        <span data-testid="late-amount" className="num font-medium text-pink-300">
          {formatUSD(late.lateCents)}
        </span>{" "}
        late
      </span>
      {late.interestCents !== null ? (
        <>
          <span aria-hidden className="text-fg-3">
            ·
          </span>
          <span>
            ~
            <span data-testid="late-interest" className="num font-medium">
              {formatUSD(late.interestCents)}
            </span>{" "}
            interest accruing <span className="text-fg-2">({late.interestStates.join(", ")})</span>
          </span>
          {!late.interestVerified ? <UnverifiedBadge /> : null}
        </>
      ) : null}
      {unknown.length > 0 ? (
        <span data-testid="late-interest-gap" className="text-[13px] text-fg-2">
          {late.interestCents !== null ? "Not counted: " : "Interest accruing: unknown. "}
          {unknown.join(", ")} {unknown.length === 1 ? "has" : "have"} no usable interest rule, so no rate is assumed.
        </span>
      ) : null}
    </p>
  );
}

/**
 * The most urgent fact on the dashboard, ahead of everything else (R2-02): obligations already past their
 * deterministic deadline, from the shared overdue assessment (src/lib/overdue.ts). Pink = a person is needed now.
 * Renders nothing when nothing is overdue, so a quiet dashboard stays quiet. Dates are demo-clock dates.
 */
export function DashboardOverdue({ summary, lateMoney }: { summary: Omit<OverdueSummary, "flags">; lateMoney: LateMoneySummary }) {
  if (summary.count === 0) return null;
  const shown = summary.items.slice(0, MAX_ROWS);
  const more = summary.count - shown.length;
  return (
    <section
      aria-labelledby="overdue-h"
      data-testid="overdue-panel"
      className="relative mb-10 grid min-w-0 gap-x-10 gap-y-4 overflow-hidden rounded-[10px] border border-pink-700 bg-pink-900/45 px-5 py-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]"
    >
      <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-pink-500" />
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id="overdue-h" className="flex items-center gap-2 font-mono text-[11px] font-medium tracking-[0.08em] text-pink-300 uppercase">
            <CircleAlert className="size-4 shrink-0" strokeWidth={1.5} aria-hidden />
            Overdue
          </h2>
          <span className="text-xs text-fg-2">
            as of <time dateTime={summary.asOf}>{formatDate(summary.asOf)}</time>
          </span>
        </div>
        <p className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span data-testid="overdue-count" className="num text-[40px] leading-none font-medium tracking-[-0.03em] text-pink-400">
            {summary.count}
          </span>
          <span className="text-sm text-fg-1">
            {summary.count === 1 ? "item is" : "items are"} past a filing deadline,{" "}
            <span data-testid="overdue-amount" className="num font-medium">
              {formatUSD(summary.total.cents)}
            </span>
          </span>
          {!summary.verified ? <UnverifiedBadge className="self-center" /> : null}
        </p>
        <p className="mt-2 text-[13px] text-fg-2">
          {summary.byState.map((s) => `${s.state} ${plural(s.count, "item")}`).join(" · ")}. Dates come from the rules engine; file or resolve
          these first.
        </p>
        <LateMoneyLine late={lateMoney} />
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
          {lateMoney.catchUp ? (
            <Link
              href={catchUpHref(lateMoney.catchUp.state)}
              data-testid="catch-up-btn"
              className={cn(buttonVariants(), "group/cta gap-2")}
              aria-describedby="late-money"
            >
              Generate &amp; file catch-up report
              <ArrowRight className="size-4 transition-transform duration-150 group-hover/cta:translate-x-0.5" strokeWidth={1.75} aria-hidden />
            </Link>
          ) : null}
          <Link
            href="/items?overdue=1"
            className="group inline-flex items-center gap-1.5 rounded-[6px] text-[13px] font-medium text-pink-300 transition-colors duration-150 hover:text-fg-1"
          >
            {more > 0 ? `See all ${summary.count} overdue items` : "Open in Items"}
            <ArrowRight className="size-3.5 transition-transform duration-150 group-hover:translate-x-0.5" strokeWidth={1.75} aria-hidden />
          </Link>
          {summary.unknownCount > 0 ? <UnknownBadge label={`${plural(summary.unknownCount, "item")} with a date unknown, not counted`} /> : null}
        </div>
      </div>
      <ul className="min-w-0 self-center border-pink-500/25 max-lg:border-t max-lg:pt-2 lg:border-l lg:pl-6" aria-label="Overdue items">
        {shown.map((i) => (
          <li key={i.itemId}>
            <Link
              href={`/items?item=${i.itemId}`}
              className="-mx-2 grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-0.5 rounded-[6px] px-2 py-1.5 transition-colors duration-150 hover:bg-ink-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]"
            >
              <span className="min-w-0 truncate text-[13px] font-medium text-fg-1">
                {i.payeeName}
                <span className="font-normal text-fg-2">
                  {i.checkNumber ? ` #${i.checkNumber}` : ""}, {i.state ?? "state unknown"}
                </span>
              </span>
              <Money cents={i.amount.cents} className="justify-self-end text-[13px] text-fg-1" />
              <span className="col-span-2 flex items-center gap-2 text-xs text-fg-2 sm:col-span-1 sm:justify-self-end">
                {OBLIGATION_LABEL[i.earliest.kind]} {formatDate(i.earliest.date)},{" "}
                <span className="font-medium text-pink-300">{lateLabel(i.daysLate)}</span>
                {!i.verified ? <UnverifiedBadge compact /> : null}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
