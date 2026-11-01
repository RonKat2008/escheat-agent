"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from "recharts";
import { ShieldQuestion } from "lucide-react";
import { formatUSD } from "@/lib/money";

/** Fixed per state so a filter never recolors a series (DESIGN-RESEARCH 3.3: blue-500 / blue-300 / white 55%). */
const STATE_FILL: Record<string, string> = {
  CA: "var(--color-blue-500)",
  TX: "var(--color-blue-300)",
  DE: "rgb(255 255 255 / 0.55)",
};
const fillFor = (state: string) => STATE_FILL[state] ?? "rgb(255 255 255 / 0.3)";

export interface ChartMonth {
  /** YYYY-MM */
  month: string;
  label: string;
  /** Integer cents per state. */
  cents: Record<string, number>;
  unverified: boolean;
}

/** Axis ticks only: whole dollars, compact ("$12k"). Exact amounts live in the tooltip and the table. */
function tick(cents: number): string {
  const dollars = Math.round(cents / 100);
  if (dollars >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1)}M`;
  if (dollars >= 10_000) return `$${Math.round(dollars / 1_000)}k`;
  if (dollars >= 1_000) return `$${(dollars / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return `$${dollars}`;
}

function ChartTooltip({ active, payload, label, states }: TooltipContentProps & { states: string[] }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]!.payload as ChartMonth & Record<string, number>;
  const total = states.reduce((a, s) => a + (row.cents[s] ?? 0), 0);
  return (
    <div className="min-w-44 rounded-md border border-line-hover bg-ink-3 px-3 py-2 text-xs shadow-[0_16px_48px_-8px_rgb(0_0_0/0.6)]">
      <p className="mb-1.5 font-medium text-fg-1">{String(label)}</p>
      {states.map((s) => (
        <p key={s} className="flex items-center justify-between gap-4 text-fg-2">
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="size-2 rounded-[2px]" style={{ background: fillFor(s) }} />
            {s}
          </span>
          <span className="num text-fg-1">{formatUSD(row.cents[s] ?? 0)}</span>
        </p>
      ))}
      <p className="mt-1.5 flex justify-between gap-4 border-t border-line pt-1.5 text-fg-2">
        Total <span className="num text-fg-1">{formatUSD(total)}</span>
      </p>
      {row.unverified ? (
        <p className="mt-1.5 flex items-center gap-1 text-fg-3">
          <ShieldQuestion className="size-3" strokeWidth={1.75} aria-hidden /> Rests on unverified rules
        </p>
      ) : null}
    </div>
  );
}

/**
 * Stacked monthly bars by state. Static (no entry animation) so it paints complete and needs no reduced-motion
 * branch. The table below carries the same numbers for screen readers; the chart itself is one labelled image.
 */
export function ForecastChart({ months, states, summary }: { months: ChartMonth[]; states: string[]; summary: string }) {
  const data = months.map((m) => ({ ...m, ...Object.fromEntries(states.map((s) => [s, m.cents[s] ?? 0])) }));
  return (
    <figure className="m-0">
      <div role="img" aria-label={summary} data-testid="forecast-chart" className="h-[240px] w-full sm:h-[280px]">
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 800, height: 280 }}>
          <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barCategoryGap="22%">
            <CartesianGrid vertical={false} stroke="rgb(255 255 255 / 0.06)" />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={{ stroke: "rgb(255 255 255 / 0.14)" }}
              tick={{ fill: "var(--color-fg-3)", fontSize: 11 }}
              interval="preserveStartEnd"
              minTickGap={8}
            />
            <YAxis tickFormatter={tick} tickLine={false} axisLine={false} width={48} tick={{ fill: "var(--color-fg-3)", fontSize: 11 }} />
            <Tooltip cursor={{ fill: "rgb(255 255 255 / 0.04)" }} content={(p) => <ChartTooltip {...p} states={states} />} />
            {states.map((s, i) => (
              <Bar
                key={s}
                dataKey={s}
                stackId="liability"
                fill={fillFor(s)}
                isAnimationActive={false}
                radius={i === states.length - 1 ? [2, 2, 0, 0] : 0}
                maxBarSize={36}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-2">
        {states.map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5">
            <span aria-hidden className="size-2.5 rounded-[2px]" style={{ background: fillFor(s) }} />
            {s}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
