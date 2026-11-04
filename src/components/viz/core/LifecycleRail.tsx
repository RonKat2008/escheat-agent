"use client";

import { m, useReducedMotion } from "motion/react";
import { useId, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  formatLifecycleDate,
  layoutLifecycle,
  LC_TYPE,
  type LcLabel,
  type LifecycleInput,
  type LifecycleLayout,
  type LifecycleNode,
} from "./lifecycle-model";
import { LifecycleRailList } from "./LifecycleRailList";
import { VIZ } from "./palette";
import { SrTable } from "./SrTable";
import { useRenderTier } from "./useRenderTier";

export type LifecycleVariant = "default" | "compact" | "owner";

export interface LifecycleRailProps extends LifecycleInput {
  title?: string;
  /** The caller already shows a heading: keep the title for assistive tech only. */
  hideTitle?: boolean;
  className?: string;
  variant?: LifecycleVariant;
}

/**
 * `width` is only the first-paint guess before the container is measured; after that the rail is laid out in real px.
 * Date ticks are off: the rail spaces stages by date and rank (see railScale), so evenly dated ticks would mislead; each
 * stage label carries its own date instead.
 */
const VARIANTS: Record<LifecycleVariant, { width: number; ticks: boolean }> = {
  default: { width: 640, ticks: false },
  compact: { width: 520, ticks: false },
  owner: { width: 520, ticks: false },
};

const EASE = [0.16, 1, 0.3, 1] as const;
const DRAW_S = 0.9;

function stateWord(n: LifecycleNode): string {
  if (n.state === "unknown") return n.reason === "not_applicable" ? "Not applicable" : "Unknown";
  if (n.state === "past") return "Past";
  return n.state === "next" ? (n.urgent ? "Next, due within 7 days" : "Next") : "Upcoming";
}

/** Measured content width of the rail's box (null until the first layout effect, i.e. during SSR). */
function useBoxWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const w = Math.floor(el.getBoundingClientRect().width);
      if (w > 0) setWidth(w);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, width };
}

function Marker({ n, y }: { n: LifecycleNode; y: number }) {
  if (n.state === "unknown") {
    return <circle cx={n.x} cy={y} r={5} fill="none" stroke={VIZ.fg4} strokeWidth={1.5} strokeDasharray="2 2" />;
  }
  if (n.state === "past") return <circle cx={n.x} cy={y} r={5} fill={VIZ.blue500} />;
  if (n.state === "next") return <circle cx={n.x} cy={y} r={6} fill={VIZ.ink0} stroke={n.urgent ? VIZ.pink500 : VIZ.blue500} strokeWidth={2} />;
  return <circle cx={n.x} cy={y} r={5} fill={VIZ.ink0} stroke={VIZ.fg3} strokeWidth={1.5} />;
}

function captionClass(l: LcLabel): string {
  if (l.kind === "lane" || l.kind === "tick") return "fill-fg-3";
  return "fill-blue-300";
}

function LabelText({ l, nodes }: { l: LcLabel; nodes: Map<string, LifecycleNode> }) {
  return (
    <g textAnchor={l.align} data-testid="lifecycle-label" data-key={l.key} data-kind={l.kind}>
      {l.lines.map((line, i) => {
        if (line.role === "caption") {
          return (
            <text key={i} x={l.textX} y={line.y} className={cn("font-mono", captionClass(l))} fontSize={LC_TYPE.captionSize} letterSpacing={`${LC_TYPE.captionTracking}em`}>
              {line.text}
            </text>
          );
        }
        if (line.role === "label") {
          return (
            <text key={i} x={l.textX} y={line.y} className="fill-fg-1" fontSize={LC_TYPE.labelSize} fontWeight={500}>
              {line.text}
            </text>
          );
        }
        const n = line.key ? nodes.get(line.key) : undefined;
        const tone = !n?.date ? "fill-fg-3" : n.urgent ? "fill-pink-400" : "fill-fg-2";
        return (
          <text key={i} x={l.textX} y={line.y} className={cn("num font-mono", tone)} fontSize={LC_TYPE.dateSize}>
            {line.text}
          </text>
        );
      })}
      {l.badges.map((b, i) => (
        <g key={`b${i}`} transform={`translate(${b.x}, ${b.y})`}>
          <rect x={0.5} y={0.5} width={LC_TYPE.badgeW - 1} height={LC_TYPE.badgeH - 1} rx={2} fill="none" stroke={VIZ.lineStrong} strokeWidth={1} />
          <text x={LC_TYPE.badgeW / 2} y={10.5} textAnchor="middle" className="fill-fg-2 font-mono" fontSize={9.5} letterSpacing="0.06em">
            UNVERIFIED
          </text>
        </g>
      ))}
    </g>
  );
}

function RailSvg({ layout, label, ticks, animated }: { layout: LifecycleLayout; label: string; ticks: boolean; animated: boolean }) {
  const { width, horizontal: h } = layout;
  const y = h.axisY;
  const nodes = new Map(layout.nodes.map((n) => [n.key, n]));
  const next = layout.nodes.find((n) => n.state === "next");
  const hasProgress = layout.progressEnd > layout.trackStart;
  const t0 = animated ? DRAW_S : 0;
  const todayLabel = h.labels.find((l) => l.today);
  // TODAY's own caption sits in the row next to the rail; the marker line reaches it.
  const todayTop = todayLabel && todayLabel.kind === "today" && todayLabel.side === "above" ? todayLabel.box.y1 + 2 : y - 16;
  const todayBottom = todayLabel && todayLabel.kind === "today" && todayLabel.side === "below" ? todayLabel.box.y0 - 2 : y + 16;

  return (
    <svg viewBox={`0 0 ${width} ${h.height}`} width="100%" height={h.height} style={{ display: "block" }} role="img" aria-label={label}>
      {ticks
        ? layout.ticks.map((t) => <line key={t.date} x1={t.x} x2={t.x} y1={y - 4} y2={y + 4} stroke={VIZ.lineStrong} strokeWidth={1} />)
        : null}
      <line x1={layout.trackStart} x2={layout.trackEnd} y1={y} y2={y} stroke={VIZ.lineStrong} strokeWidth={2} strokeLinecap="round" />
      {h.laneRect ? (
        <rect
          x={h.laneRect.x0}
          y={h.laneRect.y0}
          width={h.laneRect.x1 - h.laneRect.x0}
          height={h.laneRect.y1 - h.laneRect.y0}
          rx={4}
          fill="none"
          stroke={VIZ.fg4}
          strokeWidth={1}
          strokeDasharray="3 3"
        />
      ) : null}

      {h.labels.map((l) =>
        l.leader ? (
          <line key={`lead-${l.key}`} x1={l.leader.x} x2={l.leader.x} y1={l.leader.y0} y2={l.leader.y1} stroke={l.today ? VIZ.blue400 : VIZ.lineStrong} strokeWidth={1} />
        ) : null,
      )}

      {/* keyed so the draw replays once the tier resolves after hydration; transform and opacity only */}
      <g key={animated ? "animated" : "static"}>
        {hasProgress ? (
          <m.line
            x1={layout.trackStart}
            x2={layout.progressEnd}
            y1={y}
            y2={y}
            stroke={VIZ.blue500}
            strokeWidth={2}
            strokeLinecap="round"
            style={{ transformBox: "fill-box", transformOrigin: "0% 50%" }}
            initial={animated ? { scaleX: 0 } : false}
            animate={{ scaleX: 1 }}
            transition={{ duration: animated ? DRAW_S : 0, ease: EASE }}
          />
        ) : null}
        <m.line
          x1={layout.todayX}
          x2={layout.todayX}
          y1={todayTop}
          y2={todayBottom}
          stroke={VIZ.blue400}
          strokeWidth={2}
          initial={animated ? { opacity: 0 } : false}
          animate={{ opacity: 1 }}
          transition={{ duration: animated ? 0.24 : 0, delay: t0, ease: EASE }}
        />
        {animated && next ? (
          <m.circle
            cx={next.x}
            cy={y}
            r={6}
            fill="none"
            stroke={next.urgent ? VIZ.pink500 : VIZ.blue500}
            strokeWidth={2}
            style={{ transformBox: "fill-box", transformOrigin: "center" }}
            initial={{ scale: 1, opacity: 0 }}
            animate={{ scale: [1, 2.6], opacity: [0.9, 0] }}
            transition={{ duration: 0.7, delay: t0 + 0.24, ease: EASE }}
          />
        ) : null}
      </g>

      {layout.nodes.map((n) => (
        <Marker key={n.key} n={n} y={y} />
      ))}
      {h.labels.map((l) => (
        <LabelText key={l.key} l={l} nodes={nodes} />
      ))}
    </svg>
  );
}

export function LifecycleRail({ title = "Lifecycle", hideTitle = false, className, variant = "default", ...input }: LifecycleRailProps) {
  const { width: guess, ticks } = VARIANTS[variant];
  const tier = useRenderTier();
  const reduced = useReducedMotion();
  const animated = tier !== "static" && !reduced;
  const titleId = useId();
  const { ref, width } = useBoxWidth();
  const layout = layoutLifecycle(input, width ?? guess, { ticks });
  const label = `${title}: ${layout.nodes.length} stages`;
  // Before measuring (server render), a container query picks the form; afterwards the model's choice wins.
  const showRail = layout.orientation === "horizontal";
  const showList = width === null || !showRail;

  return (
    <figure className={cn("m-0 flex min-w-0 flex-col gap-3", className)} aria-labelledby={titleId} data-testid="lifecycle-rail" data-orientation={width === null ? "pending" : layout.orientation}>
      <figcaption id={titleId} className={cn("font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-fg-3", hideTitle && "sr-only")}>
        {title}
      </figcaption>
      <div ref={ref} className="@container min-w-0" data-testid="lifecycle-box">
        {showRail ? (
          <div className={width === null ? "hidden @min-[480px]:block" : undefined}>
            <RailSvg layout={layout} label={label} ticks={ticks} animated={animated} />
          </div>
        ) : null}
        {showList ? (
          <LifecycleRailList
            vertical={(width === null ? layoutLifecycle(input, 360) : layout).vertical}
            label={label}
            className={width === null && showRail ? "@min-[480px]:hidden" : undefined}
          />
        ) : null}
      </div>
      <SrTable
        caption={`${title}, as of ${formatLifecycleDate(input.asOf)}`}
        columns={["Stage", "Date", "Status", "Verification", "Rule"]}
        rows={layout.nodes.map((n) => [
          n.label,
          n.date ? formatLifecycleDate(n.date) : n.reason === "not_applicable" ? "Not applicable" : "Unknown",
          stateWord(n),
          n.unverified ? "Unverified" : "Verified",
          n.rulePath ? `${n.rulePath}${n.ruleVersion ? ` (${n.ruleVersion})` : ""}` : "",
        ])}
      />
    </figure>
  );
}
