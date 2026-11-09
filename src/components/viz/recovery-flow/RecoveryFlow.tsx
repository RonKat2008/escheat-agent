"use client";

import { useId, useMemo, useRef, useState } from "react";
import { DrawPath } from "@/components/motion/DrawPath";
import { InstrumentLabel } from "@/components/primitives/v3";
import { FlowParticles } from "@/components/viz/core/FlowParticles";
import { GlowFilter } from "@/components/viz/core/GlowFilter";
import { VIZ } from "@/components/viz/core/palette";
import { SrTable } from "@/components/viz/core/SrTable";
import { useRenderTier } from "@/components/viz/core/useRenderTier";
import { VizTooltip } from "@/components/viz/core/VizTooltip";
import { formatUSD } from "@/lib/money";
import { layoutRecoveryFlow, type LaidLink, type LaidNode } from "./flow-layout";
import { buildRecoveryFlow, type FlowNodeId, type FlowTone, type RecoveryFlowRow } from "./flow-model";

const W = 640;
const H = 210;
const LABEL_W = 132;
const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

const NODE_FILL: Record<FlowTone, string> = { human: VIZ.pink500, done: VIZ.blue300, active: VIZ.blue500, neutral: VIZ.fg3 };

function linkStyle(l: LaidLink): { stroke: string; opacity: number } {
  if (l.target.tone === "human") return { stroke: VIZ.pink600, opacity: 0.45 };
  if (l.target.id === "paid") return { stroke: VIZ.blue300, opacity: 0.55 };
  return { stroke: VIZ.blue500, opacity: 0.4 };
}

type Focus = { kind: "node"; node: LaidNode; x: number; y: number } | { kind: "link"; link: LaidLink; x: number; y: number };

/** Tooltip anchor in px inside `wrap`: the top center of the hovered or focused element, kept off the edges. */
function anchor(el: Element, wrap: HTMLElement | null): { x: number; y: number } {
  const box = wrap?.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  if (!box) return { x: 0, y: 0 };
  return { x: Math.min(Math.max(r.left + r.width / 2 - box.left, 90), box.width - 90), y: Math.max(r.top - box.top, 44) };
}

export interface RecoveryFlowProps {
  rows: RecoveryFlowRow[];
  /** "recovery" is the compact variant (§4.2); the prop mirrors the dashboard Sankey's API. */
  variant?: "recovery";
}

/**
 * Compact recovery flow (§4.2, §6.11): State portals → Found → Claimed → Paid, drawn from `recoveries` rows only.
 * Link widths are proportional to cents; links into "Needs your approval" are pink, recovered money is blue-300, and
 * zero links are never drawn. Hovering or focusing a node or link dims the rest and shows amount and count; a hidden
 * table repeats every link. Under the static tier the links render fully drawn, with no particles.
 */
export function RecoveryFlow({ rows }: RecoveryFlowProps) {
  const tier = useRenderTier();
  const tipId = `flow-tip-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const [focus, setFocus] = useState<Focus | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const model = useMemo(() => buildRecoveryFlow(rows), [rows]);
  // Leave room for the right-hand labels of the last column.
  const layout = useMemo(() => layoutRecoveryFlow(model, W - LABEL_W, H), [model]);

  if (layout.links.length === 0) {
    return (
      <div data-testid="recovery-flow" data-empty="true" className="glass rounded-[18px] px-5 py-6">
        <InstrumentLabel as="p">Recovery flow</InstrumentLabel>
        <p className="mt-2 text-[13px] text-fg-2">
          No recoveries recorded yet. After a search finds money, this shows it moving from the state portals to found, claimed and paid.
        </p>
      </div>
    );
  }

  const lit = (id: FlowNodeId) => !focus || (focus.kind === "node" ? focus.node.id === id : focus.link.source.id === id || focus.link.target.id === id);
  const litLink = (l: LaidLink) => !focus || (focus.kind === "link" ? focus.link === l : focus.node.id === l.source.id || focus.node.id === l.target.id);
  const animate = tier !== "static";
  const clear = () => setFocus(null);

  return (
    <figure className="m-0 min-w-0" data-testid="recovery-flow" data-links={layout.links.length}>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <InstrumentLabel as="h2">Recovery flow</InstrumentLabel>
        <span className="num text-xs text-fg-3">
          {plural(model.totalCount, "recovery")}, {formatUSD(model.totalCents)} · from stored recoveries only
        </span>
      </div>
      <div ref={wrap} className="relative">
        <div tabIndex={0} role="region" aria-label="Recovery flow diagram, scrolls horizontally on narrow screens" className="overflow-x-auto glass rounded-[18px] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400">
          <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full max-w-[800px] min-w-[560px]" role="group" aria-label="Recovery flow from state portals to paid">
            <GlowFilter id="es-glow-recovery" />
            <g>
              {layout.links.map((l, i) => {
                const st = linkStyle(l);
                return (
                  <g
                    key={`${l.source.id}>${l.target.id}`}
                    tabIndex={0}
                    role="img"
                    aria-label={`${l.source.label} to ${l.target.label}: ${formatUSD(l.cents)}, ${plural(l.count, "recovery")}`}
                    aria-describedby={focus?.kind === "link" && focus.link === l ? tipId : undefined}
                    data-testid="recovery-flow-link"
                    className="outline-none [&:focus-visible>path:first-child]:stroke-blue-300"
                    style={{ opacity: litLink(l) ? 1 : 0.25, transition: "opacity 150ms" }}
                    onPointerEnter={(e) => setFocus({ kind: "link", link: l, ...anchor(e.currentTarget, wrap.current) })}
                    onPointerLeave={clear}
                    onFocus={(e) => setFocus({ kind: "link", link: l, ...anchor(e.currentTarget, wrap.current) })}
                    onBlur={clear}
                  >
                    <DrawPath d={l.path} fill="none" stroke={st.stroke} opacity={st.opacity} strokeWidth={Math.max(1.5, l.width)} instant={!animate} delayMs={Math.min(i, 10) * 60} />
                    {l.target.id === "pending" ? <FlowParticles d={l.path} count={3} tier={tier} filterId="es-glow-recovery" /> : null}
                  </g>
                );
              })}
            </g>
            <g>
              {layout.nodes.map((n) => {
                const last = n.column === 3 || n.x0 > (W - LABEL_W) * 0.8;
                const lx = last ? n.x1 + 8 : n.x1 + 6;
                const cy = (n.y0 + n.y1) / 2;
                return (
                  <g
                    key={n.id}
                    tabIndex={0}
                    role="img"
                    aria-label={`${n.label}: ${formatUSD(n.cents)}, ${plural(n.count, "recovery")}`}
                    aria-describedby={focus?.kind === "node" && focus.node.id === n.id ? tipId : undefined}
                    data-testid="recovery-flow-node"
                    data-node={n.id}
                    className="outline-none [&:focus-visible>rect]:stroke-blue-300"
                    style={{ opacity: lit(n.id) ? 1 : 0.25, transition: "opacity 150ms" }}
                    onPointerEnter={(e) => setFocus({ kind: "node", node: n, ...anchor(e.currentTarget, wrap.current) })}
                    onPointerLeave={clear}
                    onFocus={(e) => setFocus({ kind: "node", node: n, ...anchor(e.currentTarget, wrap.current) })}
                    onBlur={clear}
                  >
                    <rect x={n.x0} y={n.y0} width={n.x1 - n.x0} height={Math.max(2, n.y1 - n.y0)} rx={2} fill={NODE_FILL[n.tone]} stroke="transparent" strokeWidth={2} />
                    <text x={lx} y={cy - 2} fontSize={11} fill={n.tone === "human" ? VIZ.pink400 : VIZ.fg1} dominantBaseline="auto" className="font-medium">
                      {n.label}
                    </text>
                    <text x={lx} y={cy + 11} fontSize={11} fill={VIZ.fg3} className="num">
                      {formatUSD(n.cents)}
                    </text>
                  </g>
                );
              })}
            </g>
          </svg>
        </div>
        {focus ? (
            <VizTooltip open id={tipId} x={focus.x} y={focus.y}>
              {focus.kind === "link" ? (
                <>
                  <span className="block font-medium">
                    {focus.link.source.label} → {focus.link.target.label}
                  </span>
                  <span className="num block text-fg-2">
                    {formatUSD(focus.link.cents)} · {plural(focus.link.count, "recovery")}
                  </span>
                </>
              ) : (
                <>
                  <span className="block font-medium">{focus.node.label}</span>
                  <span className="num block text-fg-2">
                    {formatUSD(focus.node.cents)} · {plural(focus.node.count, "recovery")}
                  </span>
                </>
              )}
            </VizTooltip>
        ) : null}
      </div>
      <figcaption className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-fg-3">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-2 w-4 rounded-[1px] bg-pink-600/60" />
          Needs your approval
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-2 w-4 rounded-[1px] bg-blue-500/60" />
          In progress
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-2 w-4 rounded-[1px] bg-blue-300/70" />
          Paid to you
        </span>
        <span>Width is proportional to the amount.</span>
      </figcaption>
      {/* A table ignores width:1px and overflow:hidden, so the sr-only wrapper does the clipping. */}
      <div className="sr-only">
      <SrTable
        caption="Recovery flow: money found on the replica state portals and where each claim stands"
        columns={["From", "To", "Amount", "Recoveries"]}
        rows={layout.links.map((l) => [l.source.label, l.target.label, formatUSD(l.cents), String(l.count)])}
      />
      </div>
    </figure>
  );
}
