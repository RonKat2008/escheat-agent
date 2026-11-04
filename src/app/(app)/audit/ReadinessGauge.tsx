"use client";

import { DrawPath } from "@/components/motion/DrawPath";
import { GlowFilter } from "@/components/viz/core/GlowFilter";
import { useRenderTier } from "@/components/viz/core/useRenderTier";
import { VIZ } from "@/components/viz/core/palette";
import type { Readiness } from "@/lib/audit/score";
import { cn } from "@/lib/utils";

const W = 240;
const H = 136;
const CX = W / 2;
const CY = 120;
const R = 100;

/** Point on the upper semicircle at fraction f (0 = left end, 1 = right end). */
function at(f: number): [number, number] {
  const a = Math.PI * (1 - f);
  return [CX + R * Math.cos(a), CY - R * Math.sin(a)];
}

/** Arc from fraction a to b along the gauge (always the short way: at most a half circle). */
export function gaugeArc(a: number, b: number): string {
  const [x0, y0] = at(a);
  const [x1, y1] = at(b);
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${R} ${R} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

/**
 * Readiness gauge: proven links over required links (not-required links are left out). The proven share is blue, the
 * missing share (a person must act) pink, links not yet due a dim dashed track. Static under reduced motion.
 */
export function ReadinessGauge({ score, className }: { score: Readiness; className?: string }) {
  const instant = useRenderTier() === "static";
  const req = Math.max(score.required, 1);
  const p = score.proven / req;
  const m = score.missing / req;
  const label = score.pct === null ? "Nothing required" : `${score.pct}% ready`;
  return (
    <figure className={cn("flex flex-col items-center", className)} data-testid="readiness-gauge" data-pct={score.pct ?? ""}>
      <div className="relative" style={{ width: W, height: H }}>
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Readiness ${label}: ${score.proven} of ${score.required} required links proven, ${score.missing} missing, ${score.notYetDue} not yet due.`}>
          <GlowFilter id="readiness-glow" stdDeviation={3} />
          <path d={gaugeArc(0, 1)} fill="none" stroke={VIZ.ink4} strokeWidth={14} strokeLinecap="round" />
          <path d={gaugeArc(0, 1)} fill="none" stroke={VIZ.fg4} strokeWidth={1} strokeDasharray="2 5" />
          {m > 0 ? <DrawPath d={gaugeArc(p, Math.min(1, p + m))} fill="none" stroke={VIZ.pink500} strokeWidth={14} delayMs={420} durationMs={700} instant={instant} /> : null}
          {p > 0 ? <DrawPath d={gaugeArc(0, p)} fill="none" stroke={VIZ.blue500} strokeWidth={14} strokeLinecap="round" filter="url(#readiness-glow)" durationMs={900} instant={instant} /> : null}
          {[0.25, 0.5, 0.75].map((f) => {
            const [x, y] = at(f);
            const [xi, yi] = [CX + (x - CX) * 0.8, CY + (y - CY) * 0.8];
            return <line key={f} x1={xi} y1={yi} x2={CX + (x - CX) * 0.84} y2={CY + (y - CY) * 0.84} stroke={VIZ.fg4} strokeWidth={1} />;
          })}
        </svg>
        <div className="pointer-events-none absolute inset-x-0 bottom-1 flex flex-col items-center">
          <span className="num text-[44px] leading-none font-medium tracking-[-0.04em] text-fg-1" data-testid="readiness-pct">
            {score.pct === null ? "n/a" : `${score.pct}%`}
          </span>
          <span className="mt-1 text-[11px] text-fg-3">
            <span className="num text-fg-2">{score.proven}</span> of <span className="num text-fg-2">{score.required}</span> required links proven
          </span>
        </div>
      </div>
    </figure>
  );
}
