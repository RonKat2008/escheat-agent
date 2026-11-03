"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from "react";
import { useReducedMotion } from "motion/react";
import { formatWholeUSD } from "@/components/motion/number-format";
import { FlowParticles, GlowFilter, useRenderTier, VIZ, VizTooltip } from "@/components/viz/core";
import type { FlowLink, FlowNode, LateInterest } from "@/lib/queries/flow";
import { formatUSD } from "@/lib/money";
import { cn } from "@/lib/utils";
import { flowSignature, layoutFlow, particleBudget, rowSegments, stackCards, type FlowLayoutOpts, type LaidBand, type LaidCard } from "./sankey-model";
import "./sankey.css";

export interface MoneyFlowSankeyProps {
  nodes: FlowNode[];
  links: FlowLink[];
  /** Interest riding on the Late card (rules engine); omitted when nothing is late. */
  lateInterest?: LateInterest | null;
  /** Layout knobs (the recovery band is a short strip). */
  layout?: FlowLayoutOpts;
  /** Play the first-visit reveal (columns fade in left to right). */
  play?: boolean;
  /** Reveal start, ms after mount, when playing. */
  drawAtMs?: number;
  /** Accessible name of the diagram. */
  label?: string;
  className?: string;
}

const COL_STAGGER = 160;
const MORPH_MS = 650;
const TIP_HALF = 120;

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

const items = (n: number) => `${n} ${n === 1 ? "item" : "items"}`;

function bandColor(l: FlowLink): { fill: string; opacity: number } {
  if (l.tone === "late") return { fill: VIZ.pink500, opacity: 0.6 };
  if (l.tone === "human") return { fill: VIZ.pink600, opacity: 0.45 };
  if (l.tone === "recovered") return { fill: VIZ.blue300, opacity: 0.45 };
  return { fill: VIZ.blue600, opacity: 0.42 };
}

/** Segment colors for the phone bars (same meaning as the bands). */
function segmentClass(l: FlowLink): string {
  if (l.tone === "late") return "bg-pink-500";
  if (l.tone === "human") return "bg-pink-700";
  if (l.tone === "recovered") return "bg-blue-300";
  if (l.target === "to_report") return "bg-blue-400";
  if (l.target === "dd") return "bg-blue-600";
  if (l.target === "needs_rule") return "bg-fg-3";
  return "bg-blue-800";
}

const interestText = (i: LateInterest | null | undefined): string | null => {
  if (!i) return null;
  if (i.cents !== null) return `+ ~${formatUSD(i.cents)} interest`;
  if (i.unknownStates.length > 0) return `Interest unknown: no rule for ${i.unknownStates.join(", ")}`;
  return null;
};

/**
 * The rest of a card's accessible name, after its visible text (rendered sr-only at the end of the link, so the name
 * always starts with what is on screen; WCAG 2.5.3 label in name). Carries the exact cents for screen readers.
 */
function cardDetails(n: FlowNode, interest: string | null): string {
  const extra = [
    `${formatUSD(n.cents)}, ${items(n.count)}`,
    n.kind === "late" && interest ? interest : null,
    n.needsYou ? "needs you" : null,
    n.unverified > 0 ? "some dates UNVERIFIED" : null,
  ].filter(Boolean);
  return `. ${extra.join(", ")}. Opens Items.`;
}

function bandText(l: FlowLink, label: (id: string) => string): string {
  const also = l.alsoListed > 0 ? ` Items also lists the ${items(l.alsoListed)} of this kind that are late.` : "";
  const why = l.tone === "late" ? " Past a deadline." : l.tone === "human" ? " Needs a person: a deadline within 7 days or a letter awaiting approval." : "";
  return `${label(l.source)} → ${label(l.target)}: ${formatUSD(l.cents)}, ${items(l.count)}.${why}${also}`;
}

interface Tip {
  x: number;
  y: number;
  body: string;
}

/**
 * Money-flow diagram (DESIGN-V3 §4.2, rebuilt for R4-07). From sm up: cards per column with bands between them, band
 * thickness = cents; every card and band is a link into the filtered Items list. Below sm: one stacked bar per state
 * with labelled, tappable segments (no vertical Sankey). When the figures change (the demo clock moves) the cards
 * slide to their new place and the bands cross-fade; reduced motion swaps instantly.
 */
export function MoneyFlowSankey({ nodes, links, lateInterest, layout, play = false, drawAtMs = 0, label = "Money flow, left to right", className }: MoneyFlowSankeyProps) {
  return (
    <div className={className}>
      <FlowCanvas nodes={nodes} links={links} lateInterest={lateInterest} opts={layout} play={play} drawAtMs={drawAtMs} label={label} className="hidden sm:block" />
      <FlowBars nodes={nodes} links={links} lateInterest={lateInterest} label={label} className="sm:hidden" />
    </div>
  );
}

function FlowCanvas({
  nodes,
  links,
  lateInterest,
  opts,
  play,
  drawAtMs,
  label,
  className,
}: {
  nodes: FlowNode[];
  links: FlowLink[];
  lateInterest?: LateInterest | null;
  opts?: FlowLayoutOpts;
  play: boolean;
  drawAtMs: number;
  label: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const width = useWidth(ref);
  const tier = useRenderTier();
  const reduced = useReducedMotion();
  const motionOk = tier !== "static" && !reduced;
  const reveal = play && motionOk;
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const tipId = `tip-${uid}`;
  const [tip, setTip] = useState<Tip | null>(null);
  const [hot, setHot] = useState<string | null>(null);
  const [particlesOn, setParticlesOn] = useState(false);

  // Morph: keep the previous figures for one cross-fade when the data (not the width) changes.
  const sig = flowSignature(nodes);
  const [shown, setShown] = useState({ sig, nodes, links });
  const [prev, setPrev] = useState<{ nodes: FlowNode[]; links: FlowLink[] } | null>(null);
  if (shown.sig !== sig) {
    setPrev(motionOk ? { nodes: shown.nodes, links: shown.links } : null);
    setShown({ sig, nodes, links });
  }
  useEffect(() => {
    if (!prev) return;
    const id = window.setTimeout(() => setPrev(null), MORPH_MS);
    return () => window.clearTimeout(id);
  }, [prev]);

  const height = useMemo(() => stackCards(nodes, opts).height, [nodes, opts]);
  const lay = useMemo(() => (width > 0 ? layoutFlow(nodes, links, width, opts) : null), [nodes, links, width, opts]);
  const prevLay = useMemo(() => (prev && width > 0 ? layoutFlow(prev.nodes, prev.links, width, opts) : null), [prev, width, opts]);
  const budget = useMemo(() => particleBudget(lay?.bands ?? []), [lay]);
  const maxCol = Math.max(0, ...nodes.map((n) => n.column));
  const interest = interestText(lateInterest);
  const labelOf = (id: string) => nodes.find((n) => n.id === id)?.label ?? id;
  const colOf = (id: string) => nodes.find((n) => n.id === id)?.column ?? 0;

  useEffect(() => {
    if (tier !== "full") return;
    const id = window.setTimeout(() => setParticlesOn(true), reveal ? drawAtMs + (maxCol + 1) * COL_STAGGER + 700 : 0);
    return () => window.clearTimeout(id);
  }, [tier, reveal, drawAtMs, maxCol]);

  const clampX = (x: number) => Math.min(Math.max(x, Math.min(TIP_HALF, width / 2)), Math.max(width - TIP_HALF, width / 2));
  const onBandMove = (e: RPointerEvent<SVGElement>, b: LaidBand) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    setHot(`${b.source}>${b.target}`);
    setTip({ x: clampX(e.clientX - r.left), y: e.clientY - r.top, body: bandText(b, labelOf) });
  };
  const onBandFocus = (b: LaidBand) => {
    setHot(`${b.source}>${b.target}`);
    setTip({ x: clampX((b.sx + b.tx) / 2), y: Math.min(b.sy, b.ty), body: bandText(b, labelOf) });
  };
  const clear = () => {
    setHot(null);
    setTip(null);
  };
  const isRelated = (b: LaidBand) => hot === null || hot === `${b.source}>${b.target}` || hot === b.source || hot === b.target;
  const revealStyle = (col: number): CSSProperties | undefined => (reveal ? { animationDelay: `${drawAtMs + col * COL_STAGGER}ms` } : undefined);

  return (
    <div ref={ref} className={cn("relative w-full min-w-0", className)} style={{ height }} onPointerLeave={clear} data-flow-root>
      {lay ? (
        <>
          <svg width={width} height={height} className="absolute inset-0 block overflow-visible" role="group" aria-label={label}>
            <GlowFilter id={`glow-${uid}`} />
            {prevLay ? (
              <g aria-hidden className="es-flow-out pointer-events-none">
                {prevLay.bands.map((b) => (
                  <path key={`${b.source}-${b.target}`} d={b.d} fill="none" stroke={bandColor(b).fill} opacity={bandColor(b).opacity} strokeWidth={b.width} />
                ))}
              </g>
            ) : null}
            <g key={shown.sig} className={cn(prev && "es-flow-in")}>
              {lay.bands.map((b, i) => {
                const c = bandColor(b);
                const key = `${b.source}>${b.target}`;
                return (
                  <a
                    key={key}
                    href={b.href}
                    data-flow-band={key}
                    data-tone={b.tone}
                    aria-label={bandText(b, labelOf)}
                    aria-describedby={hot === key && tip ? tipId : undefined}
                    onFocus={() => onBandFocus(b)}
                    onBlur={clear}
                    className={cn("outline-none [&:focus-visible>path:first-child]:stroke-blue-300", reveal && "es-flow-in")}
                    style={revealStyle(colOf(b.source))}
                  >
                    <path d={b.d} fill="none" stroke="transparent" strokeWidth={b.width + 4} />
                    <path
                      d={b.d}
                      fill="none"
                      stroke={c.fill}
                      opacity={isRelated(b) ? c.opacity : c.opacity * 0.35}
                      strokeWidth={b.width}
                      style={{ transition: "opacity 150ms" }}
                    />
                    {tier === "static" ? <path d={b.d} fill="none" stroke={VIZ.fg2} strokeOpacity={0.5} strokeWidth={1} strokeDasharray="2 7" aria-hidden /> : null}
                    <FlowParticles d={b.d} count={budget[i] ?? 0} tier={tier} active={particlesOn && !prev} filterId={`glow-${uid}`} durationMs={3600} />
                    {/* wide transparent hit area for hover */}
                    <path
                      d={b.d}
                      fill="none"
                      stroke="transparent"
                      strokeWidth={Math.max(10, b.width)}
                      onPointerMove={(e) => onBandMove(e, b)}
                      onPointerLeave={clear}
                    />
                  </a>
                );
              })}
            </g>
          </svg>
          {lay.cards.map((n) => (
            <FlowCard
              key={n.id}
              n={n}
              interest={n.kind === "late" ? interest : null}
              interestVerified={lateInterest?.verified ?? true}
              dim={hot !== null && hot !== n.id && !hot.split(">").includes(n.id)}
              motionOk={motionOk}
              reveal={reveal}
              revealStyle={revealStyle(n.column)}
              onHover={(on) => setHot(on ? n.id : null)}
            />
          ))}
        </>
      ) : null}
      {tip ? (
        <VizTooltip open id={tipId} x={tip.x} y={tip.y}>
          {tip.body}
        </VizTooltip>
      ) : null}
    </div>
  );
}

function FlowCard({
  n,
  interest,
  interestVerified,
  dim,
  motionOk,
  reveal,
  revealStyle,
  onHover,
}: {
  n: LaidCard;
  interest: string | null;
  interestVerified: boolean;
  dim: boolean;
  motionOk: boolean;
  reveal: boolean;
  revealStyle?: CSSProperties;
  onHover: (on: boolean) => void;
}) {
  const late = n.kind === "late";
  const muted = n.kind === "closed";
  return (
    <Link
      href={n.href ?? "/items"}
      data-flow-node={n.id}
      onPointerEnter={() => onHover(true)}
      onPointerLeave={() => onHover(false)}
      onFocus={() => onHover(true)}
      onBlur={() => onHover(false)}
      className={cn(
        "absolute top-0 left-0 flex flex-col justify-center overflow-hidden rounded-[6px] border px-2.5 py-1.5 outline-none focus-visible:ring-2 focus-visible:ring-blue-400",
        motionOk && "es-flow-card",
        late ? "border-pink-500 bg-pink-950/90" : n.needsYou ? "border-pink-500/70 bg-ink-1" : muted ? "border-line bg-ink-1" : "border-line-strong bg-ink-1",
        "hover:border-blue-400",
        dim && "opacity-60",
      )}
      style={{ transform: `translate(${n.x}px, ${n.y}px)`, width: n.w, height: n.h, ...(motionOk ? {} : { transition: "none" }) }}
    >
      <span className={cn("flex min-w-0 flex-col", reveal && "es-flow-in")} style={revealStyle}>
        <span className={cn("truncate text-[12px] leading-4 font-medium", late || n.needsYou ? "text-pink-300" : muted ? "text-fg-2" : "text-fg-1")}>
          {late ? "Late + interest" : n.label}
        </span>
        <span className="flex items-baseline gap-1.5 leading-5 whitespace-nowrap">
          <span className="num text-[14px] font-medium tracking-[-0.01em] text-fg-1">{formatWholeUSD(n.cents)}</span>
          <span className="num text-[11px] text-fg-3">{n.count}</span>
        </span>
        {late && interest ? (
          <span className="flex min-w-0 items-center gap-1 text-[11px] leading-4 text-pink-200">
            <span className="truncate">{interest.replace(" interest", "")}</span>
            {!interestVerified ? <span className="shrink-0 font-mono text-[9px] tracking-[0.06em] text-fg-2">UNVERIFIED</span> : null}
          </span>
        ) : n.unverified > 0 ? (
          <span className="mt-0.5 w-fit rounded-[2px] border border-line-strong px-1 font-mono text-[9px] leading-3.5 tracking-[0.06em] text-fg-2">UNVERIFIED</span>
        ) : null}
      </span>
      <span className="sr-only">{cardDetails(n, interest)}</span>
    </Link>
  );
}

/** Phone layout: one stacked bar per state (or per source), with every segment a labelled, tappable link. */
function FlowBars({ nodes, links, lateInterest, label, className }: { nodes: FlowNode[]; links: FlowLink[]; lateInterest?: LateInterest | null; label: string; className?: string }) {
  const sourceCol = Math.max(0, ...links.map((l) => nodes.find((n) => n.id === l.source)?.column ?? 0));
  const rows = nodes.filter((n) => n.column === sourceCol && links.some((l) => l.source === n.id));
  const leaves = nodes.filter((n) => n.column === sourceCol && !links.some((l) => l.source === n.id));
  const labelOf = (id: string) => nodes.find((n) => n.id === id)?.label ?? id;
  const interest = interestText(lateInterest);
  return (
    <div className={className} role="group" aria-label={label} data-flow-bars>
      <ul className="flex flex-col gap-4">
        {rows.map((r) => {
          const segs = rowSegments(links, r.id);
          return (
            <li key={r.id} data-flow-row={r.id}>
              <Link href={r.href ?? "/items"} data-flow-node={r.id} className="flex items-baseline justify-between gap-3 rounded-sm">
                <span className={cn("min-w-0 truncate text-[13px] font-medium", r.needsYou ? "text-pink-300" : "text-fg-1")}>{r.label}</span>
                <span className="num shrink-0 text-[13px] text-fg-1">
                  {formatWholeUSD(r.cents)} <span className="text-fg-3">· {r.count}</span>
                </span>
                <span className="sr-only">{cardDetails(r, null)}</span>
              </Link>
              <div aria-hidden className="mt-1.5 flex h-2.5 gap-[2px] overflow-hidden rounded-full">
                {segs.map((s) => (
                  <span key={s.link.target} className={cn("h-full", segmentClass(s.link))} style={{ width: `${s.pct}%` }} />
                ))}
              </div>
              <ul className="mt-1.5 flex flex-wrap gap-x-1 gap-y-1">
                {segs.map(({ link: l }) => (
                  <li key={l.target}>
                    <Link
                      href={l.href}
                      data-flow-band={`${l.source}>${l.target}`}
                      data-tone={l.tone}
                      className="inline-flex min-h-6 items-center gap-1.5 rounded-[4px] px-1.5 text-[12px] text-fg-2 hover:bg-ink-2 hover:text-fg-1"
                    >
                      <span aria-hidden className={cn("size-2 shrink-0 rounded-[2px]", segmentClass(l))} />
                      <span className={cn(l.tone === "late" || l.tone === "human" ? "text-pink-300" : undefined)}>{l.target === "late" ? "Late" : labelOf(l.target)}</span>
                      <span className="num text-fg-1">{formatWholeUSD(l.cents)}</span>
                      <span className="sr-only">. {bandText(l, labelOf)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ul>
      {interest && links.some((l) => l.tone === "late") ? (
        <p className="mt-3 flex flex-wrap items-center gap-x-2 text-[12px] text-pink-200">
          Late money {interest}
          {lateInterest && !lateInterest.verified ? <span className="font-mono text-[9px] tracking-[0.06em] text-fg-2">UNVERIFIED</span> : null}
        </p>
      ) : null}
      {leaves.length > 0 ? (
        <p className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-fg-2">
          {leaves.map((n) => (
            <Link key={n.id} href={n.href ?? "/items"} data-flow-node={n.id} className="inline-flex min-h-6 items-center gap-1 hover:text-fg-1">
              {n.label} <span className="num text-fg-1">{formatWholeUSD(n.cents)}</span>
              <span className="sr-only">{cardDetails(n, null)}</span>
            </Link>
          ))}
        </p>
      ) : null}
    </div>
  );
}
