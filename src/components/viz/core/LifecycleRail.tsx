"use client";

import { m, useReducedMotion } from "motion/react";
import { useId, useMemo } from "react";
import { cn } from "@/lib/utils";
import { layoutLifecycle, MAX_ROW, type LifecycleInput, type LifecycleNode } from "./lifecycle-model";
import { VIZ } from "./palette";
import { SrTable } from "./SrTable";
import { useRenderTier } from "./useRenderTier";

export type LifecycleVariant = "default" | "compact" | "owner";

export interface LifecycleRailProps extends LifecycleInput {
  title?: string;
  className?: string;
  variant?: LifecycleVariant;
}

const VARIANTS: Record<LifecycleVariant, { width: number; minPx: number; ticks: boolean }> = {
  default: { width: 720, minPx: 640, ticks: true },
  compact: { width: 560, minPx: 480, ticks: false },
  owner: { width: 640, minPx: 560, ticks: true },
};

const AXIS_Y = 56;
const ROW_H = 54;
const EASE = [0.16, 1, 0.3, 1] as const;
const DRAW_S = 0.9;

const fmtDate = (iso: string) =>
  new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${iso}T00:00:00Z`),
  );

function anchorFor(x: number, w: number): "start" | "middle" | "end" {
  if (x < 56) return "start";
  if (x > w - 56) return "end";
  return "middle";
}

function stateWord(n: LifecycleNode): string {
  if (n.state === "unknown") return n.reason === "not_applicable" ? "Not applicable" : "Unknown";
  if (n.state === "past") return "Past";
  return n.state === "next" ? (n.urgent ? "Next, due within 7 days" : "Next") : "Upcoming";
}

function Marker({ n }: { n: LifecycleNode }) {
  const ring = n.urgent ? VIZ.pink500 : VIZ.blue500;
  if (n.state === "unknown") {
    return <circle cx={n.x} cy={AXIS_Y} r={5} fill="none" stroke={VIZ.fg4} strokeWidth={1.5} strokeDasharray="2 2" />;
  }
  if (n.state === "past") return <circle cx={n.x} cy={AXIS_Y} r={5} fill={VIZ.blue500} />;
  if (n.state === "next") return <circle cx={n.x} cy={AXIS_Y} r={6} fill={VIZ.ink0} stroke={ring} strokeWidth={2} />;
  return <circle cx={n.x} cy={AXIS_Y} r={5} fill={VIZ.ink0} stroke={VIZ.fg3} strokeWidth={1.5} />;
}

function NodeLabel({ n, w }: { n: LifecycleNode; w: number }) {
  const anchor = anchorFor(n.x, w);
  const y = AXIS_Y + 26 + n.row * ROW_H;
  const dateClass = n.urgent ? "fill-pink-400" : "fill-fg-2";
  return (
    <g textAnchor={anchor}>
      <line x1={n.x} x2={n.x} y1={AXIS_Y + 8} y2={y - 11} stroke={VIZ.lineStrong} strokeWidth={1} />
      <text x={n.x} y={y} className="fill-fg-1" fontSize={12} fontWeight={500}>
        {n.label}
      </text>
      <text x={n.x} y={y + 14} className={cn("num font-mono", n.date ? dateClass : "fill-fg-3")} fontSize={11}>
        {n.date ? fmtDate(n.date) : n.reason === "not_applicable" ? "N/A" : "Unknown"}
      </text>
      {n.unverified ? (
        <g transform={`translate(${anchor === "start" ? n.x : anchor === "end" ? n.x - 74 : n.x - 37}, ${y + 20})`}>
          <rect width={74} height={14} rx={2} fill="none" stroke={VIZ.lineStrong} strokeWidth={1} />
          <text x={37} y={10.5} textAnchor="middle" className="fill-fg-2 font-mono" fontSize={9.5} letterSpacing="0.06em">
            UNVERIFIED
          </text>
        </g>
      ) : null}
    </g>
  );
}

export function LifecycleRail({ title = "Lifecycle", className, variant = "default", ...input }: LifecycleRailProps) {
  const { width, minPx, ticks } = VARIANTS[variant];
  const tier = useRenderTier();
  const reduced = useReducedMotion();
  const animated = tier !== "static" && !reduced;
  const titleId = useId();
  const layout = useMemo(() => layoutLifecycle(input, width), [input, width]);

  const maxRow = layout.nodes.reduce((a, n) => Math.max(a, n.row), 0);
  const hasBadge = layout.nodes.some((n) => n.unverified);
  const height = AXIS_Y + 26 + Math.min(maxRow, MAX_ROW) * ROW_H + (hasBadge ? 44 : 30);
  const next = layout.nodes.find((n) => n.state === "next");
  const pulse = next?.urgent ? VIZ.pink500 : VIZ.blue500;
  const hasProgress = layout.progressEnd > layout.trackStart;
  const t0 = animated ? DRAW_S : 0;

  return (
    <figure className={cn("m-0 flex flex-col gap-3", className)} aria-labelledby={titleId}>
      <figcaption id={titleId} className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-fg-3">
        {title}
      </figcaption>
      <div
        className="overflow-x-auto"
        tabIndex={0}
        role="region"
        aria-label={`${title} timeline, scrolls horizontally on narrow screens`}
      >
        <svg
          viewBox={`0 0 ${width} ${height}`}
          width="100%"
          style={{ minWidth: minPx, display: "block" }}
          role="img"
          aria-label={`${title}: ${layout.nodes.length} stages`}
        >
          {ticks
            ? layout.ticks.map((t) => (
                <g key={t.date}>
                  <line x1={t.x} x2={t.x} y1={AXIS_Y - 4} y2={AXIS_Y + 4} stroke={VIZ.lineStrong} strokeWidth={1} />
                  <text x={t.x} y={AXIS_Y - 12} textAnchor={anchorFor(t.x, width)} className="num fill-fg-3 font-mono" fontSize={10}>
                    {fmtDate(t.date)}
                  </text>
                </g>
              ))
            : null}
          <line x1={layout.trackStart} x2={layout.trackEnd} y1={AXIS_Y} y2={AXIS_Y} stroke={VIZ.lineStrong} strokeWidth={2} />
          {layout.unknownLane ? (
            <g>
              <rect
                x={layout.unknownLane.x0 - 8}
                y={AXIS_Y - 22}
                width={layout.unknownLane.x1 - layout.unknownLane.x0 + 16}
                height={height - AXIS_Y + 12}
                rx={4}
                fill="none"
                stroke={VIZ.fg4}
                strokeWidth={1}
                strokeDasharray="3 3"
              />
              <text x={layout.unknownLane.x0 - 2} y={AXIS_Y - 28} className="fill-fg-3 font-mono" fontSize={10} letterSpacing="0.08em">
                UNKNOWN
              </text>
            </g>
          ) : null}

          {/* keyed so the draw replays once the tier resolves after hydration */}
          <g key={animated ? "animated" : "static"}>
            {hasProgress ? (
              <m.path
                d={`M ${layout.trackStart} ${AXIS_Y} L ${layout.progressEnd} ${AXIS_Y}`}
                stroke={VIZ.blue500}
                strokeWidth={2}
                fill="none"
                strokeLinecap="round"
                initial={animated ? { pathLength: 0 } : false}
                animate={{ pathLength: 1 }}
                transition={{ duration: animated ? DRAW_S : 0, ease: EASE }}
              />
            ) : null}
            <m.g
              style={{ transformBox: "fill-box", transformOrigin: "center" }}
              initial={animated ? { opacity: 0, y: -6 } : false}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: animated ? 0.24 : 0, delay: t0, ease: EASE }}
            >
              <line x1={layout.todayX} x2={layout.todayX} y1={AXIS_Y - 16} y2={AXIS_Y + 16} stroke={VIZ.blue400} strokeWidth={2} />
              <text x={layout.todayX} y={AXIS_Y + 30} textAnchor={anchorFor(layout.todayX, width)} className="fill-blue-300 font-mono" fontSize={10} letterSpacing="0.08em">
                TODAY
              </text>
            </m.g>
            {animated && next ? (
              <m.circle
                cx={next.x}
                cy={AXIS_Y}
                r={6}
                fill="none"
                stroke={pulse}
                strokeWidth={2}
                style={{ transformBox: "fill-box", transformOrigin: "center" }}
                initial={{ scale: 1, opacity: 0 }}
                animate={{ scale: [1, 2.6], opacity: [0.9, 0] }}
                transition={{ duration: 0.7, delay: t0 + 0.24, ease: EASE }}
              />
            ) : null}
          </g>

          {layout.nodes.map((n) => (
            <g key={n.key}>
              <Marker n={n} />
              {variant === "compact" && n.state !== "next" ? null : <NodeLabel n={n} w={width} />}
            </g>
          ))}
        </svg>
      </div>
      <SrTable
        caption={`${title}, as of ${input.asOf}`}
        columns={["Stage", "Date", "Status", "Verification", "Rule"]}
        rows={layout.nodes.map((n) => [
          n.label,
          n.date ?? (n.reason === "not_applicable" ? "Not applicable" : "Unknown"),
          stateWord(n),
          n.unverified ? "Unverified" : "Verified",
          n.rulePath ? `${n.rulePath}${n.ruleVersion ? ` (${n.ruleVersion})` : ""}` : "",
        ])}
      />
    </figure>
  );
}
