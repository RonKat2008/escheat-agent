"use client";

import Link from "next/link";
import { useId, type CSSProperties } from "react";
import { ArrowUpRight, CircleAlert, CircleCheck, CircleDashed, CircleMinus, ExternalLink, type LucideIcon } from "lucide-react";
import { DrawPath } from "@/components/motion/DrawPath";
import { UnverifiedBadge } from "@/components/primitives";
import { GlowFilter } from "@/components/viz/core/GlowFilter";
import { useRenderTier } from "@/components/viz/core/useRenderTier";
import { SrTable } from "@/components/viz/core/SrTable";
import { VIZ } from "@/components/viz/core/palette";
import type { ProofLink } from "@/lib/audit/proof-chain";
import { cn } from "@/lib/utils";
import { chainNodes, chainSrRows, chainSummary, type ChainNode, type ChainTone } from "./chain-model";

const ICON: Record<ChainTone, LucideIcon> = { blue: CircleCheck, pink: CircleAlert, dim: CircleDashed, muted: CircleMinus };

const CARD: Record<ChainTone, string> = {
  blue: "border-blue-800 bg-ink-2",
  pink: "border-pink-700 bg-pink-950",
  dim: "border-line bg-ink-1",
  muted: "border-dashed border-line bg-transparent",
};
const STATUS_TEXT: Record<ChainTone, string> = { blue: "text-blue-300", pink: "text-pink-300", dim: "text-fg-3", muted: "text-fg-3" };

function Bead({ node, filterId }: { node: ChainNode; filterId: string }) {
  const fill = node.tone === "blue" ? VIZ.blue500 : node.tone === "pink" ? VIZ.pink500 : VIZ.ink1;
  const stroke = node.tone === "dim" ? VIZ.fg4 : node.tone === "muted" ? VIZ.lineStrong : fill;
  return (
    <span className="es-ping-once absolute top-0 left-1/2 -ml-3 block size-6" style={{ animationDelay: `${node.delayMs + 260}ms` }}>
      <svg width={24} height={24} viewBox="0 0 24 24" aria-hidden focusable="false" className="overflow-visible">
        <circle
          cx={12}
          cy={12}
          r={node.glow ? 5 : 4.5}
          fill={fill}
          stroke={stroke}
          strokeWidth={1.5}
          strokeDasharray={node.tone === "muted" ? "2 2" : undefined}
          filter={node.glow ? `url(#${filterId})` : undefined}
        />
        {node.tone === "pink" ? <circle cx={12} cy={12} r={9} fill="none" stroke={VIZ.pink500} strokeOpacity={0.35} strokeWidth={1} /> : null}
      </svg>
    </span>
  );
}

function LinkCard({ node }: { node: ChainNode }) {
  const { link, tone } = node;
  const Icon = ICON[tone];
  const source = link.sources[0];
  return (
    <div
      className={cn(
        "es-rise relative flex h-full min-h-[184px] flex-col gap-2 overflow-hidden rounded-[8px] border px-3 pt-2.5 pb-3",
        CARD[tone],
      )}
      style={{ animationDelay: `${node.delayMs}ms` } as CSSProperties}
    >
      {tone === "pink" ? <span aria-hidden className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-pink-500 via-pink-500/40 to-transparent" /> : null}
      {tone === "blue" ? <span aria-hidden className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-blue-500/80 via-blue-500/20 to-transparent" /> : null}
      <div className="flex items-baseline justify-between gap-2">
        <span className="num font-mono text-[10px] tracking-[0.08em] text-fg-3">{node.ordinal}</span>
        <span className={cn("inline-flex items-center gap-1 text-[11px] font-medium whitespace-nowrap", STATUS_TEXT[tone])} data-testid="proof-status">
          <Icon className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
          {node.statusText}
        </span>
      </div>
      <h4 className="text-[12.5px] leading-snug font-medium text-pretty text-fg-1">{link.label}</h4>
      <p className={cn("text-[12px] leading-[1.45] text-pretty [overflow-wrap:anywhere]", tone === "pink" ? "text-fg-1" : "text-fg-2")} title={link.evidence}>
        {link.evidence}
      </p>
      {link.detail.length > 0 ? <p className="text-[11px] leading-snug text-fg-3 [overflow-wrap:anywhere]" title={link.detail.join(" · ")}>{link.detail.join(" · ")}</p> : null}
      <div className="mt-auto flex flex-col items-start gap-1.5 pt-1">
        {link.unverified ? <UnverifiedBadge /> : null}
        {source ? (
          <a
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            title={source.title}
            className="inline-flex max-w-full items-start gap-1 rounded-sm text-[11px] text-blue-300 hover:text-blue-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400"
          >
            <span className="min-w-0 [overflow-wrap:anywhere]">{source.title}</span>
            <ExternalLink className="size-3 shrink-0" strokeWidth={1.5} aria-hidden />
            <span className="sr-only">(source, opens in a new tab)</span>
          </a>
        ) : null}
        {link.fix ? (
          <Link
            href={link.fix.href}
            data-testid="proof-fix"
            className="group/fix mt-0.5 flex w-full items-center justify-between gap-1.5 rounded-[6px] border border-pink-700 bg-ink-1 px-2 py-1.5 text-[12px] leading-tight text-pink-200 transition-colors duration-150 hover:border-pink-500 hover:bg-pink-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pink-400"
          >
            <span className="min-w-0">
              <span className="font-mono text-[10px] tracking-[0.08em] text-pink-300 uppercase">Fix</span>
              <span className="sr-only"> {link.label}:</span> <span className="text-fg-1">{link.fix.label}</span>
            </span>
            <ArrowUpRight className="size-3.5 shrink-0 transition-transform duration-150 group-hover/fix:translate-x-0.5 group-hover/fix:-translate-y-0.5" strokeWidth={1.75} aria-hidden />
          </Link>
        ) : null}
      </div>
    </div>
  );
}

export interface ProofChainProps {
  links: ProofLink[];
  /** Names the item for the region label and the screen-reader table. */
  itemLabel: string;
  /** Draw the links in sequence (DrawPath); false renders the finished chain. Reduced motion is always static. */
  animate?: boolean;
  className?: string;
}

/**
 * The audit proof chain: nine links drawn left to right. Proven links are blue, missing links that need a person are
 * pink (each with a Fix link to its gate), links not yet due are dim and links not required are muted. The rail draws
 * in sequence; under reduced motion everything is static. A visually hidden table carries the same facts.
 */
export function ProofChain({ links, itemLabel, animate: wantsAnimation = true, className }: ProofChainProps) {
  // "static" on SSR and the hydration render (so server and client HTML match), then the device's real tier.
  const tier = useRenderTier();
  const animate = wantsAnimation && tier !== "static";
  const filterId = `proof-glow-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const nodes = chainNodes(links, { animate });
  return (
    <figure className={cn("min-w-0", className)} data-testid="proof-chain">
      <svg width={0} height={0} className="absolute" aria-hidden focusable="false">
        <GlowFilter id={filterId} stdDeviation={2.5} />
      </svg>
      <figcaption className="sr-only">
        Proof chain for {itemLabel}: {chainSummary(links)}.
      </figcaption>
      <div
        className="max-w-full overflow-x-auto rounded-md pb-1 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400 [contain:inline-size]"
        tabIndex={0}
        role="region"
        aria-label={`Proof chain for ${itemLabel} (scrolls sideways)`}
      >
        <ol className="grid min-w-[1060px] grid-cols-9 gap-x-2" aria-label={`${itemLabel}: nine proof links`}>
          {nodes.map((n) => (
            <li key={n.link.kind} className="relative flex flex-col gap-2" data-testid="proof-link" data-kind={n.link.kind} data-status={n.link.status}>
              <div className="relative h-6">
                <svg viewBox="0 0 100 24" preserveAspectRatio="none" className="absolute top-0 left-[-4px] h-6 w-[calc(100%+8px)] overflow-visible" aria-hidden focusable="false">
                  <DrawPath d={n.rail.d} fill="none" stroke={n.rail.stroke} strokeWidth={1.5} strokeDasharray={n.rail.dash} vectorEffect="non-scaling-stroke" delayMs={n.delayMs} durationMs={420} instant={!animate} />
                </svg>
                <Bead node={n} filterId={filterId} />
              </div>
              <LinkCard node={n} />
            </li>
          ))}
        </ol>
      </div>
      <SrTable caption={`Proof chain for ${itemLabel}`} columns={["Link", "Status", "Evidence", "Fix"]} rows={chainSrRows(links)} />
    </figure>
  );
}
