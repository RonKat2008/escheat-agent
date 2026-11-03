import Link from "next/link";
import { ArrowRight, TriangleAlert } from "lucide-react";
import { Money, UnknownBadge, UnverifiedBadge } from "@/components/primitives";
import { formatDate, plural } from "@/lib/format";
import { formatUSD } from "@/lib/money";
import { lateLabel, OBLIGATION_LABEL } from "@/lib/overdue";
import type { OverdueSummary } from "@/lib/queries";
import { cn } from "@/lib/utils";

/**
 * The most urgent fact on a page: obligations already past their deterministic deadline. Pink (needs a human). Every
 * row comes from the shared overdue assessment (src/lib/overdue.ts); unverified rule values keep their marker.
 * Renders nothing when nothing is overdue, so quiet pages stay quiet.
 */
export function OverduePanel({
  summary,
  maxRows = 3,
  className,
  context,
}: {
  summary: Omit<OverdueSummary, "flags">;
  maxRows?: number;
  className?: string;
  /** Optional sentence after the headline (e.g. what the forecast leaves out). */
  context?: string;
}) {
  if (summary.count === 0) return null;
  const shown = summary.items.slice(0, maxRows);
  const more = summary.count - shown.length;
  return (
    <section
      aria-labelledby="overdue-h"
      data-testid="overdue-panel"
      className={cn("relative min-w-0 overflow-hidden rounded-xl border border-pink-500/50 bg-pink-900/40", className)}
    >
      <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-pink-500" />
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 px-5 pt-4 sm:pl-6">
        <h2 id="overdue-h" className="flex items-center gap-2 text-[13px] font-medium text-pink-300">
          <TriangleAlert className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
          Overdue
        </h2>
        <span className="text-xs text-fg-3">
          as of <time dateTime={summary.asOf}>{formatDate(summary.asOf)}</time>
        </span>
      </div>
      <div className="px-5 pt-2 pb-4 sm:pl-6">
        <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
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
          {summary.byState.map((s) => `${s.state} ${plural(s.count, "item")}`).join(" · ")}. Dates come from the rules engine; file or
          resolve these first.{context ? ` ${context}` : ""}
        </p>
        <ul className="-mx-2 mt-3 border-t border-pink-500/20 pt-2" aria-label="Overdue items">
          {shown.map((i) => (
            <li key={i.itemId}>
              <Link
                href={`/items?item=${i.itemId}`}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-0.5 rounded-md px-2 py-1.5 transition-colors duration-150 hover:bg-ink-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]"
              >
                <span className="min-w-0 truncate text-[13px] font-medium text-fg-1">
                  {i.payeeName}
                  <span className="font-normal text-fg-3">
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
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <Link
            href="/items?overdue=1"
            className="group inline-flex items-center gap-1.5 rounded-md text-[13px] font-medium text-pink-300 transition-colors duration-150 hover:text-fg-1"
          >
            {more > 0 ? `See all ${summary.count} overdue items` : "Open in Items"}
            <ArrowRight className="size-3.5 transition-transform duration-150 group-hover:translate-x-0.5" strokeWidth={1.75} aria-hidden />
          </Link>
          {summary.unknownCount > 0 ? (
            <UnknownBadge label={`${plural(summary.unknownCount, "item")} with a date unknown, not counted`} />
          ) : null}
        </div>
      </div>
    </section>
  );
}
