"use client";

import { useId, useRef } from "react";
import { VIZ } from "./palette";
import type { RenderTier } from "./render-tier";
import { useInViewport } from "./useInViewport";

export const MAX_PARTICLES = 12;

export interface FlowParticlesProps {
  /** SVG path data the particles travel along. */
  d: string;
  /** Particle count, capped at 12. */
  count: number;
  color?: string;
  durationMs?: number;
  tier: RenderTier;
  active?: boolean;
  /** Optional filter id (e.g. "es-glow") applied to the heads. */
  filterId?: string;
  /** Override viewport detection (e.g. when the parent already tracks it). */
  inView?: boolean;
}

/**
 * Compositor-friendly particles: SVG circles moved with CSS offset-path.
 * Renders nothing unless tier === "full" and active. Pauses off-screen.
 */
export function FlowParticles({
  d,
  count,
  color = VIZ.blue200,
  durationMs = 3200,
  tier,
  active = true,
  filterId,
  inView,
}: FlowParticlesProps) {
  const ref = useRef<SVGGElement>(null);
  const observed = useInViewport(ref);
  const visible = inView ?? observed;
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const n = Math.max(0, Math.min(MAX_PARTICLES, Math.floor(count)));

  if (tier !== "full" || !active || n === 0) return null;

  const anim = `es-flow-${uid}`;
  return (
    <g ref={ref} aria-hidden="true" filter={filterId ? `url(#${filterId})` : undefined}>
      <style>{`@keyframes ${anim}{from{offset-distance:0%}to{offset-distance:100%}}`}</style>
      {Array.from({ length: n }, (_, i) => (
        <circle
          key={i}
          r={2.5}
          cx={0}
          cy={0}
          fill={color}
          style={{
            offsetPath: `path("${d}")`,
            offsetRotate: "0deg",
            animation: `${anim} ${durationMs}ms linear infinite`,
            animationDelay: `${-(durationMs / n) * i}ms`,
            animationPlayState: visible ? "running" : "paused",
          }}
        />
      ))}
    </g>
  );
}
