"use client";

import { Landmark } from "lucide-react";
import NumberFlow from "@number-flow/react";
import { Cell, Pie, PieChart } from "recharts";
import type { ExposureUi } from "@/lib/chat/ui-types";
import { cn } from "@/lib/utils";
import { fmtDate, FooterLink, UnverifiedFlag, useChatActions, ViewCard } from "./parts";

/** Series order from the spec: blue-500, blue-300, then neutral white at decreasing strength. No other hues. */
const SERIES = ["var(--chat-blue-500)", "var(--chat-blue-300)", "rgb(255 255 255 / 0.55)", "rgb(255 255 255 / 0.32)", "rgb(255 255 255 / 0.2)"];
const tint = (i: number) => SERIES[i] ?? "rgb(255 255 255 / 0.14)";
const USD_FORMAT = { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 } as const;

export function ExposureView({ exposure, state }: ExposureUi["props"]) {
  const { ask, canAsk } = useChatActions();
  const rows = [...exposure.byState].sort((a, b) => b.cents - a.cents);
  const max = Math.max(1, ...rows.map((r) => r.cents));
  const pie = rows.map((r) => ({ name: r.state, value: r.cents }));

  return (
    <ViewCard
      testId="view-exposure"
      icon={<Landmark />}
      title={state ? `Open exposure in ${state}` : "Open unclaimed-property exposure"}
      meta={`as of ${fmtDate(exposure.asOf)}`}
      footer={
        <>
          <FooterLink href="/dashboard">Dashboard</FooterLink>
          <FooterLink href={state ? `/items?state=${state}` : "/items"}>All items</FooterLink>
        </>
      }
    >
      <div className="grid gap-5 p-4 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center sm:gap-7 sm:p-5">
        <div className="flex items-center gap-4">
          <div className="relative size-[104px] shrink-0" aria-hidden>
            <PieChart width={104} height={104}>
              <Pie data={pie} dataKey="value" innerRadius={36} outerRadius={50} paddingAngle={2} stroke="none" startAngle={90} endAngle={-270} isAnimationActive animationDuration={700}>
                {pie.map((p, i) => (
                  <Cell key={p.name} fill={tint(i)} />
                ))}
              </Pie>
            </PieChart>
            <span className="absolute inset-0 grid place-items-center text-[11px] font-medium text-[var(--chat-t3)] tabular-nums">{rows.length} states</span>
          </div>
          <div className="min-w-0">
            <p className="text-[28px] leading-none font-semibold tracking-[-0.01em] text-[var(--chat-t1)] tabular-nums" data-testid="exposure-total" aria-label={exposure.total.formatted}>
              <NumberFlow value={exposure.total.cents / 100} format={USD_FORMAT} locales="en-US" aria-hidden />
            </p>
            <p className="mt-2 text-[13px] text-[var(--chat-t3)] tabular-nums">
              {exposure.itemCount} open {exposure.itemCount === 1 ? "item" : "items"}
            </p>
            {exposure.anyUnverified ? <UnverifiedFlag className="mt-2.5" /> : null}
          </div>
        </div>

        <ul className="space-y-1" aria-label="Exposure by owner state">
          {rows.map((r, i) => (
            <li key={r.state}>
              <button
                type="button"
                disabled={!canAsk}
                onClick={() => ask(`Show the open ${r.state} items`)}
                className="group grid w-full grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-3 rounded-md px-2 py-2 text-left outline-none transition-colors duration-150 hover:bg-[var(--chat-ink-3)] focus-visible:ring-2 focus-visible:ring-[var(--chat-blue-text)] disabled:cursor-default"
                aria-label={`${r.state}: ${r.formatted} across ${r.count} items. Show ${r.state} items`}
              >
                <span className="text-[13px] font-semibold text-[var(--chat-t1)]">{r.state}</span>
                <span className="relative h-1.5 overflow-hidden rounded-full bg-[var(--chat-ink-3)]">
                  <span
                    className="absolute inset-y-0 left-0 origin-left rounded-full transition-transform duration-700 ease-[var(--chat-ease)]"
                    style={{ width: `${(r.cents / max) * 100}%`, background: tint(i) }}
                  />
                </span>
                <span className="flex items-center gap-2 text-right">
                  <span className="text-[13px] text-[var(--chat-t1)] tabular-nums">{r.formatted}</span>
                  <span className={cn("w-14 text-xs text-[var(--chat-t3)] tabular-nums", "group-hover:text-[var(--chat-blue-text)]")}>{r.count} items</span>
                </span>
              </button>
            </li>
          ))}
          {rows.length === 0 ? <li className="px-2 py-3 text-sm text-[var(--chat-t3)]">No open items.</li> : null}
        </ul>
      </div>
    </ViewCard>
  );
}
