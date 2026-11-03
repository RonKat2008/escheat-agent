"use client";

import { useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";
import { DrawPath } from "@/components/motion/DrawPath";
import { InstrumentLabel } from "@/components/primitives";
import { SrTable } from "@/components/viz/core/SrTable";
import { VIZ } from "@/components/viz/core/palette";
import { cn } from "@/lib/utils";
import { chainThrough, layoutProvenance, type ProvenanceInput, type ProvenanceNode } from "./provenance-model";

const DRAW_STAGGER_MS = 60;

function NodeBody({ node }: { node: ProvenanceNode }) {
  if (node.column === "verification" && node.hollow) {
    return (
      <>
        <span className="inline-flex h-[18px] w-fit items-center rounded-[4px] border border-line-strong px-1.5 font-mono text-[10px] leading-none font-medium tracking-[0.08em] text-fg-2 uppercase">
          {node.label}
        </span>
        {node.sublabel ? <span className="truncate text-[11px] text-fg-3">{node.sublabel}</span> : null}
      </>
    );
  }
  const mono = node.column === "path";
  return (
    <>
      <span
        className={cn(
          "truncate",
          mono ? "font-mono text-[11px] text-fg-2" : "text-[12px] text-fg-1",
          node.hollow && "text-fg-3 italic",
          node.column === "source" && node.href && "text-blue-400",
        )}
      >
        {node.label}
      </span>
      {node.sublabel ? <span className={cn("truncate text-[11px] text-fg-3", mono && "font-mono text-fg-1")}>{node.sublabel}</span> : null}
    </>
  );
}

/**
 * DESIGN-V3 §4.4 rule provenance graph: value → rule path → sources → verification, drawn from the rule file only.
 * Source nodes are real links (new tab). Hover or focus highlights the chain through a node; the links draw once.
 * A visually hidden table carries the same facts for screen readers.
 */
export function ProvenanceGraph({ input, className }: { input: ProvenanceInput; className?: string }) {
  const layout = useMemo(() => layoutProvenance(input), [input]);
  const [hot, setHot] = useState<string | null>(null);
  const chain = useMemo(() => (hot ? chainThrough(layout, hot) : null), [layout, hot]);

  const srRows = layout.nodes.map((n) => [
    n.column === "source" ? "Source" : n.column === "derivation" ? "Derivation step" : n.column === "path" ? "Rule path" : n.column === "value" ? "Value" : "Verification",
    [n.label, n.sublabel, n.href].filter(Boolean).join(", "),
  ]);

  return (
    <figure className={cn("min-w-0", className)} data-testid="provenance-graph">
      <figcaption className="mb-2 flex items-baseline justify-between gap-3">
        <InstrumentLabel>Rule provenance</InstrumentLabel>
        <span className="text-[11px] text-fg-3">From rules/{input.state.toUpperCase()}.json</span>
      </figcaption>
      <div
        className="max-w-full overflow-x-auto rounded-md outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400 [contain:inline-size]"
        tabIndex={0}
        role="region"
        aria-label="Rule provenance graph (scrolls sideways)"
      >
        <div className="relative" style={{ width: layout.width, height: layout.height }}>
          <svg width={layout.width} height={layout.height} className="absolute inset-0 overflow-visible" focusable="false" aria-hidden>
            {layout.links.map((l, i) => {
              const lit = chain?.links.has(l.id) ?? false;
              return (
                <DrawPath
                  key={l.id}
                  d={l.d}
                  fill="none"
                  stroke={lit ? VIZ.blue400 : l.dashed ? VIZ.fg4 : VIZ.blue500}
                  strokeWidth={lit ? 1.75 : 1.25}
                  strokeDasharray={l.dashed ? "4 4" : undefined}
                  opacity={chain && !lit ? 0.35 : 1}
                  delayMs={Math.min(i, 10) * DRAW_STAGGER_MS}
                />
              );
            })}
          </svg>
          {layout.columns.map((c) => (
            <span key={c.column} aria-hidden className="instrument-label absolute top-0 truncate" style={{ left: c.x, width: c.width }}>
              {c.label}
            </span>
          ))}
          {layout.nodes.map((n) => {
            const dim = chain && !chain.nodes.has(n.id);
            const cls = cn(
              "absolute flex flex-col justify-center gap-0.5 overflow-hidden rounded-[6px] border px-2.5 text-left transition-opacity duration-150",
              n.hollow ? "border-dashed border-fg-4 bg-ink-1" : "border-line-hover bg-ink-2",
              n.column === "verification" && !n.hollow && "border-blue-700",
              dim && "opacity-40",
            );
            const style = { left: n.x, top: n.y, width: n.width, height: n.height };
            const hover = { onMouseEnter: () => setHot(n.id), onMouseLeave: () => setHot(null), onFocus: () => setHot(n.id), onBlur: () => setHot(null) };
            if (n.href) {
              return (
                <a
                  key={n.id}
                  href={n.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={n.quote ? `“${n.quote}”` : n.href}
                  className={cn(cls, "hover:border-blue-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400")}
                  style={style}
                  data-testid="provenance-source"
                  {...hover}
                >
                  <NodeBody node={n} />
                  <ExternalLink className="absolute top-1.5 right-1.5 size-3 text-fg-3" strokeWidth={1.5} aria-hidden />
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
              );
            }
            return (
              <div key={n.id} className={cls} style={style} title={n.label} data-node={n.column} aria-hidden {...hover}>
                <NodeBody node={n} />
              </div>
            );
          })}
        </div>
      </div>
      <SrTable caption={`Provenance of ${input.rulePath} in the ${input.state} rule file`} columns={["Step", "Detail"]} rows={srRows} />
    </figure>
  );
}
