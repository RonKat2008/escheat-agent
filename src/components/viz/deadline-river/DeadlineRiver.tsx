"use client";

import { useId, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { InstrumentLabel } from "@/components/primitives/v3";
import { SrTable } from "@/components/viz/core/SrTable";
import { useRenderTier } from "@/components/viz/core/useRenderTier";
import { VIZ } from "@/components/viz/core/palette";
import { VizTooltip } from "@/components/viz/core/VizTooltip";
import { formatDate } from "@/lib/format";
import { formatUSD } from "@/lib/money";
import { cn } from "@/lib/utils";
import { layoutRiver, RIVER_KINDS, URGENT_DAYS, urgentSummary, type RiverColumn, type RiverEvent, type RiverKind } from "./river-model";

export const RIVER_KIND_LABEL: Record<RiverKind, string> = {
  presumed_abandoned: "Presumed abandoned",
  dd_window_opens: "Due diligence opens",
  report_due: "Report due",
  remit_due: "Remit due",
};

/** Fill and edge per kind. Presumed-abandoned is a status change, not a filing, so it stays neutral. */
const KIND_STYLE: Record<RiverKind, { fill: string; stroke: string }> = {
  presumed_abandoned: { fill: VIZ.fg4, stroke: VIZ.fg3 },
  dd_window_opens: { fill: VIZ.blue300, stroke: VIZ.blue300 },
  report_due: { fill: VIZ.blue500, stroke: VIZ.blue500 },
  remit_due: { fill: VIZ.blue700, stroke: VIZ.blue400 },
};

const HEIGHT = 168;
const AXIS = 28;
const TOP = 26;
const BASE = HEIGHT - AXIS;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthName = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]}${ym.endsWith("-01") ? ` ${ym.slice(0, 4)}` : ""}`;
const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

function columnLabel(c: RiverColumn): string {
  const parts = c.segments.map((s) => `${RIVER_KIND_LABEL[s.kind]} ${plural(s.count, "item")} (${s.states.join(", ")}) ${formatUSD(s.cents)}${s.verified ? "" : ", UNVERIFIED"}`);
  const when = c.daysUntil === 0 ? "today" : `in ${plural(c.daysUntil, "day")}`;
  return `${formatDate(c.date)}, ${when}: ${parts.join("; ")}`;
}

export interface DeadlineRiverProps {
  events: RiverEvent[];
  /** Demo-clock today (YYYY-MM-DD). */
  asOf: string;
  /** Exclusive window end (YYYY-MM-DD). */
  end: string;
  /** Short caption under the title, e.g. "Nov 2026 to Oct 2027". */
  meta?: string;
}

/**
 * The deadline river (§4.5, §6.7): engine dates on a 12-month time axis from the demo clock's today, stacked by kind,
 * with the 7-day window shaded pink. The plot is wider than the viewport and scrolls inside its own container (drag
 * with a mouse, swipe on touch, arrow keys when focused). Each day column takes focus and shows a tooltip; a hidden
 * table repeats every number. Under the static tier nothing animates; otherwise columns rise once and the today line
 * pulses once.
 */
export function DeadlineRiver({ events, asOf, end, meta }: DeadlineRiverProps) {
  const tier = useRenderTier();
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const tipId = `river-tip-${uid}`;
  const scroller = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; left: number; moved: boolean } | null>(null);
  const [tip, setTip] = useState<{ col: RiverColumn; x: number } | null>(null);
  const active = tip?.col ?? null;
  const layout = useMemo(() => layoutRiver(events, { asOf, end }), [events, asOf, end]);
  const animate = tier !== "static";
  const scaleY = layout.maxHeight > BASE - TOP ? (BASE - TOP) / layout.maxHeight : 1;
  const width = layout.width + 24;

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "mouse" || e.button !== 0 || !scroller.current) return;
    drag.current = { x: e.clientX, left: scroller.current.scrollLeft, moved: false };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || !scroller.current) return;
    const dx = e.clientX - d.x;
    if (Math.abs(dx) > 3) d.moved = true;
    scroller.current.scrollLeft = d.left - dx;
  };
  /** Tooltip x within the wrapper: the column's x minus the scroll offset, kept inside the visible width. */
  const show = (c: RiverColumn) => {
    const el = scroller.current;
    const left = el?.scrollLeft ?? 0;
    const w = el?.clientWidth ?? 600;
    setTip({ col: c, x: Math.min(Math.max(c.x + 12 - left, 120), Math.max(120, w - 120)) });
  };
  const hide = (c: RiverColumn) => setTip((t) => (t?.col.date === c.date ? null : t));
  const endDrag = () => {
    drag.current = null;
  };

  const totals = RIVER_KINDS.map((k) => ({
    kind: k,
    count: layout.columns.reduce((a, c) => a + (c.segments.find((s) => s.kind === k)?.count ?? 0), 0),
  }));
  const urgentText = urgentSummary(layout.columns);

  if (layout.columns.length === 0) {
    return (
      <div data-testid="deadline-river" data-empty="true" className="glass rounded-[18px] px-5 py-10">
        <InstrumentLabel as="p">Deadline river</InstrumentLabel>
        <p className="mt-2 text-sm text-fg-1">No engine dates fall in this window.</p>
        <p className="mt-1 max-w-xl text-[13px] text-fg-3">
          Presumed-abandoned dates, due-diligence openings and report and remit due dates appear here as they come within the next 12 months of the demo
          clock. Items whose rule is missing are listed under Unknown below, never placed on the river.
        </p>
      </div>
    );
  }

  return (
    <figure className="m-0 min-w-0" data-testid="deadline-river" data-columns={layout.columns.length}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <InstrumentLabel as="h2">Deadline river</InstrumentLabel>
          {meta ? <span className="num text-xs text-fg-3">{meta}</span> : null}
        </div>
        <p className="text-xs text-fg-2" data-testid="river-urgent">
          {urgentText ? (
            <span className="text-pink-400">
              {urgentText} in the next {URGENT_DAYS} days
            </span>
          ) : (
            <span className="text-fg-3">Nothing due in the next {URGENT_DAYS} days</span>
          )}
        </p>
      </div>
      <div className="relative">
        <div
          ref={scroller}
          tabIndex={0}
          role="region"
          aria-label="Deadline river, 12 months from the demo date. Scrolls horizontally; drag or use the arrow keys."
          className="cursor-grab overflow-x-auto overscroll-x-contain glass rounded-[18px] outline-none select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400 active:cursor-grabbing"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerLeave={endDrag}
          onPointerCancel={endDrag}
        >
          <svg width={width} height={HEIGHT} viewBox={`0 0 ${width} ${HEIGHT}`} role="group" aria-label="Deadline events by day" className="block">
            <g transform="translate(12 0)">
              {/* the pink 7-day window */}
              <rect x={layout.window[0]} y={TOP - 14} width={layout.window[1] - layout.window[0]} height={BASE - TOP + 14} fill={VIZ.pink900} opacity={0.9} rx={3} />
              <text x={layout.window[0] + 6} y={TOP - 3} fontSize={10} fill={VIZ.pink300} className="font-mono tracking-[0.08em] uppercase">
                {URGENT_DAYS}d
              </text>
              {/* month gridlines */}
              {layout.ticks.map((t, i) => (
                <g key={t.month}>
                  {i > 0 ? <line x1={t.x} x2={t.x} y1={TOP - 4} y2={BASE} stroke={VIZ.line} /> : null}
                  <text x={t.x + 4} y={BASE + 18} fontSize={11} fill={VIZ.fg3} className="num">
                    {monthName(t.date)}
                  </text>
                </g>
              ))}
              <line x1={0} x2={layout.width} y1={BASE + 0.5} y2={BASE + 0.5} stroke={VIZ.lineStrong} />
              {/* event columns */}
              {layout.columns.map((c, i) => (
                <g
                  key={c.date}
                  tabIndex={0}
                  role="img"
                  aria-label={columnLabel(c)}
                  aria-describedby={active?.date === c.date ? tipId : undefined}
                  data-testid="river-column"
                  data-date={c.date}
                  data-urgent={c.urgent || undefined}
                  className={cn("outline-none [&:focus-visible>rect.hit]:stroke-blue-400", animate && "es-grow-y")}
                  style={animate ? { transformOrigin: `${c.x}px ${BASE}px`, transformBox: "view-box", ["--i" as string]: Math.min(i, 24) } : undefined}
                  onPointerEnter={() => show(c)}
                  onPointerLeave={() => hide(c)}
                  onFocus={() => show(c)}
                  onBlur={() => hide(c)}
                >
                  <rect className="hit" x={c.x - 5} y={TOP - 6} width={10} height={BASE - TOP + 6} fill="transparent" strokeWidth={1} rx={2} />
                  {c.segments.map((s) => {
                    const st = KIND_STYLE[s.kind];
                    const pink = c.urgent && s.kind !== "presumed_abandoned";
                    const h = Math.max(2, (s.y1 - s.y0) * scaleY);
                    return (
                      <rect
                        key={s.kind}
                        data-kind={s.kind}
                        x={c.x - 2.5}
                        y={BASE - s.y1 * scaleY}
                        width={5}
                        height={h}
                        rx={1.5}
                        fill={pink ? VIZ.pink500 : st.fill}
                        stroke={pink ? VIZ.pink400 : st.stroke}
                        strokeWidth={1}
                        strokeDasharray={s.verified ? undefined : "2 1.5"}
                      />
                    );
                  })}
                </g>
              ))}
              {/* today line (demo clock) */}
              <line x1={layout.todayX} x2={layout.todayX} y1={TOP - 14} y2={BASE + 4} stroke={VIZ.blue400} strokeWidth={1.5} />
              <circle cx={layout.todayX} cy={TOP - 14} r={3.5} fill={VIZ.blue400} className={animate ? "es-ping-once" : undefined} style={{ transformOrigin: `${layout.todayX}px ${TOP - 14}px`, transformBox: "view-box" }} data-testid="river-today" />
            </g>
          </svg>
        </div>
        {active ? (
          <VizTooltip open id={tipId} x={tip?.x ?? 0} y={TOP}>
            <span className="block font-medium">
              {formatDate(active.date)} <span className="text-fg-3">{active.daysUntil === 0 ? "today" : `in ${plural(active.daysUntil, "day")}`}</span>
            </span>
            {active.segments.map((s) => (
              <span key={s.kind} className="mt-0.5 flex justify-between gap-3 text-fg-2">
                <span>
                  {RIVER_KIND_LABEL[s.kind]} · {s.states.join(", ")}
                  {s.verified ? "" : " · UNVERIFIED"}
                </span>
                <span className="num text-fg-1">{plural(s.count, "item")}</span>
              </span>
            ))}
          </VizTooltip>
        ) : null}
      </div>
      <figcaption className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-fg-2">
        {totals.map((t) => (
          <span key={t.kind} className={cn("inline-flex items-center gap-1.5", t.count === 0 && "text-fg-3")}>
            <span aria-hidden className="h-3 w-1.5 rounded-[1.5px] border" style={{ background: KIND_STYLE[t.kind].fill, borderColor: KIND_STYLE[t.kind].stroke }} />
            {RIVER_KIND_LABEL[t.kind]} <span className="num text-fg-3">{t.count}</span>
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5 text-fg-3">
          <span aria-hidden className="h-3 w-3 rounded-[2px] bg-pink-900" />
          Next {URGENT_DAYS} days (pink marks need you)
        </span>
        <span className="inline-flex items-center gap-1.5 text-fg-3">
          <span aria-hidden className="h-3 w-0 border-l-[1.5px] border-blue-400" />
          Today, the demo clock ({formatDate(asOf)})
        </span>
        <span className="inline-flex items-center gap-1.5 text-fg-3">
          <span aria-hidden className="h-3 w-1.5 rounded-[1.5px] border border-dashed border-fg-3" />
          Dashed edge: rests on an UNVERIFIED rule
        </span>
      </figcaption>
      {/* A table ignores width:1px and overflow:hidden, so the sr-only wrapper does the clipping. */}
      <div className="sr-only">
      <SrTable
        caption={`Deadline river: engine dates from ${formatDate(asOf)} (demo clock) to ${formatDate(layout.ticks.at(-1)?.date ?? end)} and the rest of that month.`}
        columns={["Date", "Days from the demo date", "Kind", "Items", "States", "Amount", "Rule status"]}
        rows={layout.columns.flatMap((c) =>
          c.segments.map((s) => [formatDate(c.date), String(c.daysUntil), RIVER_KIND_LABEL[s.kind], String(s.count), s.states.join(", "), formatUSD(s.cents), s.verified ? "verified" : "UNVERIFIED"]),
        )}
      />
      </div>
    </figure>
  );
}
