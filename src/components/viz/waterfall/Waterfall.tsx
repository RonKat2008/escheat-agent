"use client";

import { SrTable } from "@/components/viz/core/SrTable";
import { useRenderTier } from "@/components/viz/core/useRenderTier";
import { cn } from "@/lib/utils";
import type { WaterfallBar } from "./waterfall-model";
import "./waterfall.css";

export interface WaterfallProps {
  bars: WaterfallBar[];
  /** Items behind each bar (shown in the accessible name). */
  counts: Record<string, number>;
  selected: string | null;
  onSelect: (id: string) => void;
  caption: string;
  /** Changing it replays the entrance (a new period or state). */
  animateKey: string;
  /** id of the element the bars open (aria-controls). */
  panelId: string;
}

const STAGGER_MS = 90;
const BAR_W = 56; // % of the column

const FILL: Record<WaterfallBar["direction"], string> = {
  total: "bg-gradient-to-t from-blue-700 via-blue-500 to-blue-400 shadow-[0_0_24px_-6px_var(--color-blue-500)]",
  up: "bg-blue-300/25 border border-blue-300/80",
  down: "es-wf-hatch bg-ink-3 border border-line-strong",
};

/**
 * Animated liability waterfall: opening and closing totals in solid electric blue, increases outlined blue, decreases
 * hatched. Bars grow with a transform (scaleY) and stay static under reduced motion or the static render tier. Every
 * bar is a button that opens the items behind it; an SrTable carries the same figures for assistive tech.
 */
export function Waterfall({ bars, counts, selected, onSelect, caption, animateKey, panelId }: WaterfallProps) {
  const tier = useRenderTier();
  const animate = tier !== "static";
  return (
    <figure className="m-0 min-w-0" data-testid="waterfall" data-animate={animate ? "true" : "false"}>
      <div key={animateKey} className="relative">
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-8 bottom-0">
          {[0, 25, 50, 75, 100].map((p) => (
            <span key={p} className={cn("absolute inset-x-0 border-t", p === 0 ? "border-line-strong" : "border-dashed border-grid")} style={{ bottom: `${p}%` }} />
          ))}
        </div>
        <ol className="relative grid h-[260px] list-none pt-8 sm:h-[300px]" style={{ gridTemplateColumns: `repeat(${bars.length}, minmax(0, 1fr))` }}>
          {bars.map((b, i) => {
            const next = bars[i + 1];
            const on = selected === b.id;
            const n = counts[b.id] ?? 0;
            const top = b.bottomPct + b.heightPct;
            return (
              <li key={b.id} className="relative h-full">
                {next ? (
                  <span
                    aria-hidden
                    className="absolute border-t border-dashed border-fg-4"
                    style={{ bottom: `${(b.direction === "down" ? b.bottomPct : top) || 0}%`, left: `${50 + BAR_W / 2}%`, width: `${100 - BAR_W}%` }}
                  />
                ) : null}
                <span
                  aria-hidden
                  className={cn("num absolute inset-x-0 text-center text-[10px] tracking-[-0.02em] whitespace-nowrap sm:text-xs sm:tracking-normal", b.direction === "total" ? "font-medium text-fg-1" : "text-fg-2", animate && "es-wf-fade")}
                  style={{ bottom: `calc(${top}% + 6px)`, animationDelay: animate ? `${i * STAGGER_MS + 380}ms` : undefined }}
                >
                  {b.display}
                </span>
                <button
                  type="button"
                  data-testid="waterfall-bar"
                  data-bar-id={b.id}
                  aria-label={`${b.label} ${b.display}, ${n} ${n === 1 ? "item" : "items"}. Show the items behind it.`}
                  aria-pressed={on}
                  aria-controls={panelId}
                  onClick={() => onSelect(b.id)}
                  data-direction={b.direction}
                  className={cn(
                    "es-wf-bar absolute rounded-[3px] outline-none transition-[filter,box-shadow] duration-150 hover:brightness-125 focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-1",
                    FILL[b.direction],
                    on && "ring-2 ring-blue-400 ring-offset-2 ring-offset-ink-1",
                    animate && "es-wf-grow",
                  )}
                  style={{
                    left: `${50 - BAR_W / 2}%`,
                    width: `${BAR_W}%`,
                    bottom: `${b.bottomPct}%`,
                    height: `max(${b.heightPct}%, 2px)`,
                    animationDelay: animate ? `${i * STAGGER_MS}ms` : undefined,
                  }}
                />
              </li>
            );
          })}
        </ol>
      </div>
      <ol aria-hidden className="mt-2 grid list-none" style={{ gridTemplateColumns: `repeat(${bars.length}, minmax(0, 1fr))` }}>
        {bars.map((b) => (
          <li key={b.id} className={cn("px-0.5 text-center text-[11px] leading-tight text-pretty sm:text-xs", selected === b.id ? "text-fg-1" : "text-fg-3")}>
            {b.label}
          </li>
        ))}
      </ol>
      <figcaption className="sr-only">{caption}</figcaption>
      <SrTable caption={caption} columns={["Line", "Amount", "Items"]} rows={bars.map((b) => [b.label, b.display, String(counts[b.id] ?? 0)])} />
    </figure>
  );
}
