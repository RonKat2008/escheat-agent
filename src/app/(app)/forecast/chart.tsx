"use client";

import { useRef } from "react";
import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from "recharts";
import { ShieldQuestion } from "lucide-react";
import { useInViewOnce } from "@/components/motion";
import { formatUSD } from "@/lib/money";
import { cn } from "@/lib/utils";
import { barPath, fillFor, monthTotal, shareLabel, tick, topStateOf, type ChartMonth } from "./chart-model";
import { useForecastUi } from "./interactions";

export type { ChartMonth } from "./chart-model";

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

function ChartTooltip({ active, payload, states, todayLabel }: TooltipContentProps & { states: string[]; todayLabel: string }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]!.payload as ChartMonth;
  const total = monthTotal(row, states);
  const items = states.reduce((a, s) => a + (row.counts[s] ?? 0), 0);
  const isFirst = row.label === todayLabel;
  return (
    <div className="w-56 rounded-lg border border-line-hover bg-ink-3/95 px-3 py-2.5 text-xs shadow-[var(--shadow-overlay)] backdrop-blur-sm">
      <p className="flex items-baseline justify-between gap-3 text-fg-2">
        <span className="font-medium text-fg-1">{row.label}</span>
        {isFirst ? <span className="text-fg-3">from today</span> : <span className="num text-fg-3">{plural(items, "item")}</span>}
      </p>
      <p className="num mt-1 text-lg leading-6 font-medium tracking-[-0.015em] text-fg-1">{formatUSD(total)}</p>
      {total > 0 ? (
        <ul className="mt-2 space-y-1 border-t border-line pt-2">
          {states
            .filter((s) => (row.cents[s] ?? 0) > 0)
            .map((s) => (
              <li key={s} className="grid grid-cols-[auto_1fr_auto] items-center gap-x-2 text-fg-2">
                <span aria-hidden className="size-2 rounded-[2px]" style={{ background: fillFor(s) }} />
                <span>
                  {s} <span className="text-fg-3">{shareLabel(row.cents[s] ?? 0, total)}</span>
                </span>
                <span className="num text-fg-1">{formatUSD(row.cents[s] ?? 0)}</span>
              </li>
            ))}
        </ul>
      ) : (
        <p className="mt-1 text-fg-3">Nothing projected this month.</p>
      )}
      {row.unverified ? (
        <p className="mt-2 flex items-center gap-1 text-fg-3">
          <ShieldQuestion className="size-3" strokeWidth={1.75} aria-hidden /> Rests on unverified rules
        </p>
      ) : null}
    </div>
  );
}

interface ShapeProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  index?: number;
  payload?: ChartMonth;
  background?: { y?: number; height?: number };
}

/**
 * One stacked segment. Every segment of a month scales from the same baseline (transform-origin at the plot bottom),
 * so the stack grows as a unit; months stagger by index. Opacity marks the cross-highlighted month.
 */
function Segment({ props, state, states, activeMonth }: { props: ShapeProps; state: string; states: string[]; activeMonth: string | null }) {
  const { x = 0, y = 0, width = 0, height = 0, index = 0, payload, background } = props;
  if (!payload || height <= 0) return null;
  const base = background?.y != null && background.height != null ? background.y + background.height : y + height;
  const dim = activeMonth !== null && activeMonth !== payload.month;
  return (
    <path
      d={barPath(x, y, width, height, 2.5, topStateOf(payload, states) === state)}
      fill={fillFor(state)}
      className="es-iv-grow-y transition-opacity duration-150"
      style={{ transformOrigin: `${x}px ${base}px`, transformBox: "view-box", opacity: dim ? 0.3 : 1, ["--i" as string]: index }}
    />
  );
}

/**
 * Stacked monthly bars by state. Bars grow from the baseline the first time the chart scrolls into view (CSS, transform
 * only; static under reduced motion). A dashed "Today" rule marks where the demo clock sits. Hovering a month dims the
 * others and highlights the same month in the table below (and the reverse). The table carries the exact numbers for
 * screen readers; the chart itself is one labelled image.
 */
export function ForecastChart({ months, states, summary }: { months: ChartMonth[]; states: string[]; summary: string }) {
  const { activeMonth, setActiveMonth } = useForecastUi();
  const wrap = useRef<HTMLDivElement>(null);
  const seen = useInViewOnce(wrap, { threshold: 0.3 });
  const data = months.map((m) => ({ ...m, ...Object.fromEntries(states.map((s) => [s, m.cents[s] ?? 0])) }));
  const labelOf = new Map(months.map((m) => [m.month, m.label]));
  const first = months[0];
  const totals = states.map((s) => ({ s, cents: months.reduce((a, m) => a + (m.cents[s] ?? 0), 0) }));

  return (
    <figure className="m-0">
      <div ref={wrap} data-inview={seen ? "true" : "false"} role="img" aria-label={summary} data-testid="forecast-chart" className="h-[240px] w-full min-w-0 overflow-hidden sm:h-[280px]">
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 800, height: 280 }}>
          <BarChart
            data={data}
            margin={{ top: 22, right: 4, bottom: 0, left: 0 }}
            barCategoryGap="22%"
            onMouseMove={(s) => {
              const i = s?.activeTooltipIndex == null ? NaN : Number(s.activeTooltipIndex);
              setActiveMonth(Number.isInteger(i) ? (months[i]?.month ?? null) : null);
            }}
            onMouseLeave={() => setActiveMonth(null)}
          >
            <CartesianGrid vertical={false} stroke="rgb(255 255 255 / 0.06)" />
            <XAxis
              dataKey="month"
              tickFormatter={(m: string) => labelOf.get(m) ?? m}
              tickLine={false}
              axisLine={{ stroke: "rgb(255 255 255 / 0.14)" }}
              tick={{ fill: "var(--color-fg-3)", fontSize: 11 }}
              interval="preserveStartEnd"
              minTickGap={8}
            />
            <YAxis tickFormatter={tick} tickLine={false} axisLine={false} width={48} tick={{ fill: "var(--color-fg-3)", fontSize: 11 }} />
            <Tooltip
              cursor={{ fill: "rgb(255 255 255 / 0.035)" }}
              isAnimationActive={false}
              content={(p) => <ChartTooltip {...p} states={states} todayLabel={first?.label ?? ""} />}
            />
            {first ? (
              <ReferenceLine
                x={first.month}
                position="start"
                stroke="rgb(255 255 255 / 0.32)"
                strokeDasharray="2 3"
                label={{ value: "Today", position: "insideTopLeft", fill: "var(--color-fg-2)", fontSize: 11, offset: 6, dy: -18 }}
              />
            ) : null}
            {states.map((s) => (
              <Bar key={s} dataKey={s} stackId="liability" fill={fillFor(s)} isAnimationActive={false} maxBarSize={36} shape={(p: unknown) => <Segment props={p as ShapeProps} state={s} states={states} activeMonth={activeMonth} />} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-fg-2">
        {totals.map(({ s, cents }) => (
          <span key={s} className={cn("inline-flex items-center gap-1.5", cents === 0 && "text-fg-3")}>
            <span aria-hidden className="size-2.5 rounded-[2px]" style={{ background: fillFor(s) }} />
            {s}
            <span className="num text-fg-3">{tick(cents)}</span>
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5 text-fg-3">
          <span aria-hidden className="h-3 w-0 border-l border-dashed border-white/35" />
          Today, the demo clock
        </span>
      </figcaption>
    </figure>
  );
}
