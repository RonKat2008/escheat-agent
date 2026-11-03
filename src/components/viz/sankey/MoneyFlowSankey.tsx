"use client";

import { useEffect, useId, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { useReducedMotion } from "motion/react";
import { DrawPath } from "@/components/motion";
import { formatWholeUSD } from "@/components/motion/number-format";
import { FlowParticles, GlowFilter, useRenderTier, VIZ, VizTooltip } from "@/components/viz/core";
import type { FlowLink, FlowNode } from "@/lib/queries/flow";
import { formatUSD } from "@/lib/money";
import { cn } from "@/lib/utils";
import { layoutSankey, particleBudget, shortLabel, type LaidLink, type LaidNode, type SankeyOrientation } from "./sankey-model";

export interface MoneyFlowSankeyProps {
  nodes: FlowNode[];
  links: FlowLink[];
  /** Fixed heights so the diagram never shifts layout. */
  height?: number;
  verticalHeight?: number;
  /**
   * "auto" draws horizontally from sm up and vertically below it (both rendered, one hidden by CSS, so nothing swaps
   * after hydration); or force one.
   */
  orientation?: SankeyOrientation | "auto";
  /** Play the left-to-right draw (first visit only). */
  play?: boolean;
  /** Draw start, ms after mount, when playing. */
  drawAtMs?: number;
  /** Read right to left (the reverse recovery band). */
  mirror?: boolean;
  className?: string;
}

const COL_STAGGER = 140;
const LABEL_GUTTER = 210;

function useWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e?.contentRect.width ?? 0)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

const compactUSD = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(Math.trunc(cents / 100));

function linkColors(l: FlowLink): { band: string; edge: string; opacity: number } {
  if (l.tone === "human") return { band: VIZ.pink600, edge: VIZ.pink500, opacity: 0.4 };
  if (l.tone === "recovered") return { band: VIZ.blue300, edge: VIZ.blue300, opacity: 0.45 };
  return { band: VIZ.blue800, edge: VIZ.blue500, opacity: 0.5 };
}

function nodeFill(n: FlowNode): string {
  if (n.needsYou) return VIZ.pink500;
  if (n.kind === "recovered") return VIZ.blue300;
  if (n.kind === "cleared" || n.kind === "notStale" || n.kind === "closed") return VIZ.fg3;
  return VIZ.blue500;
}

const nodeName = (n: FlowNode) =>
  `${n.label}: ${formatUSD(n.cents)}, ${n.count} ${n.count === 1 ? "item" : "items"}${n.needsYou ? ", needs you" : ""}${n.unverified > 0 ? ", some dates unverified" : ""}`;

/** What the node label shows on screen; the accessible name starts with it (WCAG 2.5.3 label in name). */
const visibleLabel = (n: LaidNode) =>
  n.labelSide === "below"
    ? `${shortLabel(n)} ${compactUSD(n.cents)}`
    : `${n.label} ${formatWholeUSD(n.cents)}${n.unverified > 0 ? " UNVERIFIED" : ""}`;

interface Tip {
  x: number;
  y: number;
  body: string;
}

/**
 * Money-flow Sankey (DESIGN-V3 §4.2): link widths are cents. Hover a band to isolate it; nodes are links to the
 * filtered Items list and are reachable by keyboard (focus shows the same tooltip). Full tier adds particles; static
 * draws everything at once with dashed direction marks.
 */
export function MoneyFlowSankey({ nodes, links, height = 320, verticalHeight = 560, orientation = "auto", play = false, drawAtMs = 0, mirror = false, className }: MoneyFlowSankeyProps) {
  return (
    <div className={className}>
      {orientation !== "vertical" ? (
        <SankeyCanvas nodes={nodes} links={links} height={height} orientation="horizontal" play={play} drawAtMs={drawAtMs} mirror={mirror} className={orientation === "auto" ? "hidden sm:block" : undefined} />
      ) : null}
      {orientation !== "horizontal" ? (
        <SankeyCanvas nodes={nodes} links={links} height={verticalHeight} orientation="vertical" play={play} drawAtMs={drawAtMs} className={orientation === "auto" ? "sm:hidden" : undefined} />
      ) : null}
    </div>
  );
}

function SankeyCanvas({
  nodes,
  links,
  height,
  orientation,
  play,
  drawAtMs,
  mirror = false,
  className,
}: {
  nodes: FlowNode[];
  links: FlowLink[];
  height: number;
  orientation: SankeyOrientation;
  play: boolean;
  drawAtMs: number;
  mirror?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const width = useWidth(ref);
  const tier = useRenderTier();
  const reduced = useReducedMotion();
  const animate = play && tier !== "static" && !reduced;
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const tipId = `tip-${uid}`;
  const [hoverLink, setHoverLink] = useState<number | null>(null);
  const [focusNode, setFocusNode] = useState<string | null>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const [particlesOn, setParticlesOn] = useState(false);
  const vertical = orientation === "vertical";

  const layout = useMemo(
    () =>
      width > 0
        ? layoutSankey(nodes, links, {
            width,
            height,
            nodeWidth: vertical ? 8 : 10,
            nodePadding: vertical ? 30 : 16,
            labelGutter: vertical ? 30 : Math.min(LABEL_GUTTER, width * 0.24),
          }, orientation, mirror && !vertical)
        : null,
    [nodes, links, width, height, vertical, orientation, mirror],
  );
  const maxCol = Math.max(0, ...nodes.map((n) => n.column));
  const budget = useMemo(() => particleBudget(layout?.links ?? []), [layout]);

  useEffect(() => {
    if (tier !== "full") return;
    const id = window.setTimeout(() => setParticlesOn(true), animate ? drawAtMs + (maxCol + 1) * COL_STAGGER + 900 : 0);
    return () => window.clearTimeout(id);
  }, [tier, animate, drawAtMs, maxCol]);

  const colOf = (id: string) => nodes.find((n) => n.id === id)?.column ?? 0;
  const related = (l: LaidLink) => focusNode !== null && (l.source === focusNode || l.target === focusNode);
  const isDim = (l: LaidLink, i: number) => (hoverLink !== null ? hoverLink !== i : focusNode !== null ? !related(l) : false);

  const onLinkMove = (e: RPointerEvent<SVGPathElement>, i: number, l: LaidLink) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const from = nodes.find((n) => n.id === l.source)?.label ?? l.source;
    const to = nodes.find((n) => n.id === l.target)?.label ?? l.target;
    setHoverLink(i);
    setTip({ x: e.clientX - r.left, y: e.clientY - r.top, body: `${from} → ${to}: ${formatUSD(l.cents)}, ${l.count} ${l.count === 1 ? "item" : "items"}` });
  };
  const nodeTip = (n: LaidNode) => {
    setFocusNode(n.id);
    setTip({ x: (n.x0 + n.x1) / 2, y: n.y0, body: nodeName(n) });
  };
  const clear = () => {
    setHoverLink(null);
    setFocusNode(null);
    setTip(null);
  };

  return (
    <div ref={ref} className={cn("relative w-full min-w-0", className)} style={{ height }} onPointerLeave={clear}>
      {layout ? (
        <svg width={width} height={height} className="block overflow-visible" role="group" aria-label={`Money flow, ${vertical ? "top to bottom" : "left to right"}`}>
          <GlowFilter id={`glow-${uid}`} />
          <g>
            {layout.links.map((l, i) => {
              const c = linkColors(l);
              const dim = isDim(l, i);
              return (
                <g key={`${l.source}-${l.target}`} opacity={dim ? 0.25 : 1} style={{ transition: "opacity 150ms" }}>
                  <path d={l.d} fill="none" stroke={c.edge} strokeOpacity={0.3} strokeWidth={l.width + 1.5} />
                  <DrawPath
                    d={l.d}
                    fill="none"
                    stroke={c.band}
                    opacity={c.opacity}
                    strokeWidth={l.width}
                    instant={!animate}
                    delayMs={drawAtMs + colOf(l.source) * COL_STAGGER}
                  />
                  {tier === "static" ? (
                    <path d={l.d} fill="none" stroke={VIZ.fg2} strokeOpacity={0.55} strokeWidth={1} strokeDasharray="2 7" aria-hidden />
                  ) : null}
                  <FlowParticles d={l.d} count={budget[i] ?? 0} tier={tier} active={particlesOn} filterId={`glow-${uid}`} durationMs={3600} />
                  {/* wide transparent hit area for hover */}
                  <path
                    d={l.d}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={Math.max(8, l.width)}
                    onPointerMove={(e) => onLinkMove(e, i, l)}
                    onPointerLeave={clear}
                  />
                </g>
              );
            })}
          </g>
          {layout.nodes.map((n) => (
            <a
              key={n.id}
              href={n.href ?? "/items"}
              aria-label={`${visibleLabel(n)}. ${nodeName(n)}`}
              aria-describedby={focusNode === n.id ? tipId : undefined}
              data-flow-node={n.id}
              onFocus={() => nodeTip(n)}
              onBlur={clear}
              onPointerEnter={() => nodeTip(n)}
              className="outline-none [&:focus-visible>rect:first-child]:stroke-blue-400"
            >
              <rect x={n.x0 - 3} y={n.y0 - 3} width={n.x1 - n.x0 + 6} height={Math.max(1, n.y1 - n.y0) + 6} fill="transparent" stroke="transparent" strokeWidth={2} rx={3} />
              <rect x={n.x0} y={n.y0} width={Math.max(1, n.x1 - n.x0)} height={Math.max(1, n.y1 - n.y0)} fill={nodeFill(n)} rx={1.5} />
              <NodeLabel n={n} />
            </a>
          ))}
        </svg>
      ) : null}
      {tip ? (
        <VizTooltip open id={tipId} x={tip.x} y={tip.y}>
          {tip.body}
        </VizTooltip>
      ) : null}
    </div>
  );
}

function NodeLabel({ n }: { n: LaidNode }) {
  const halo = { paintOrder: "stroke", stroke: VIZ.ink0, strokeWidth: 3, strokeLinejoin: "round" } as const;
  if (n.labelSide === "below") {
    const cx = (n.x0 + n.x1) / 2;
    return (
      <text x={cx} y={n.y1 + 12} textAnchor="middle" fontSize={10} style={halo} className="pointer-events-none">
        <tspan className="fill-fg-1" fontWeight={500}>
          {shortLabel(n)}
        </tspan>
        <tspan x={cx} dy={12} className="num fill-fg-2">
          {compactUSD(n.cents)}
        </tspan>
      </text>
    );
  }
  const right = n.labelSide === "right";
  const x = right ? n.x1 + 6 : n.x0 - 6;
  const y = (n.y0 + n.y1) / 2 + 4;
  return (
    <text x={x} y={y} textAnchor={right ? "start" : "end"} fontSize={12} style={halo} className="pointer-events-none">
      <tspan className={n.needsYou ? "fill-pink-400" : "fill-fg-1"} fontWeight={500}>
        {n.label}
      </tspan>
      {/* Real spaces (not only dx) so the read text matches the accessible name word for word. */}
      <tspan className="num fill-fg-2" dx={3}>
        {` ${formatWholeUSD(n.cents)}`}
      </tspan>
      {n.unverified > 0 ? (
        <tspan className="fill-fg-2 font-mono" fontSize={9} dx={3} letterSpacing="0.06em">
          {" UNVERIFIED"}
        </tspan>
      ) : null}
    </text>
  );
}
