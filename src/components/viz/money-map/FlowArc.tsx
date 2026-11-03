"use client";

import { useId } from "react";
import { DrawPath } from "@/components/motion";
import { FlowParticles, GlowFilter, VIZ, type RenderTier } from "@/components/viz/core";
import { cn } from "@/lib/utils";
import { arcPlane, type MapPoint } from "./map-model";

export interface FlowArcProps {
  /** Endpoints in px on the floor. */
  from: MapPoint;
  to: MapPoint;
  /** Height of the column it lands on (px). 0 = lands on the floor. */
  endHeight: number;
  tier: RenderTier;
  particles: number;
  /** First-visit draw start (ms); null = drawn already. */
  drawAtMs: number | null;
  particlesOn: boolean;
  highlighted: boolean;
  dimmed: boolean;
  /** Recovered money flowing back (blue-300, lower arc). */
  variant?: "out" | "recovered";
}

/**
 * A blue thread that rises out of the floor at HQ and lands on a column top. It is drawn in a vertical plane that
 * stands on the floor along the HQ → state heading: rotateZ(heading) then rotateX(-90deg) about its bottom-left corner,
 * so SVG "up" becomes height above the map. Decorative (aria-hidden): the columns carry the accessible names.
 */
export function FlowArc({ from, to, endHeight, tier, particles, drawAtMs, particlesOn, highlighted, dimmed, variant = "out" }: FlowArcProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const plane = arcPlane(from, to, endHeight, variant === "recovered" ? 0.55 : 1);
  if (plane.length < 24) return null; // HQ is in this state: nothing to travel
  const color = variant === "recovered" ? VIZ.blue300 : VIZ.blue500;
  return (
    <div
      aria-hidden
      className={cn("pointer-events-none absolute transition-opacity duration-150", dimmed && "opacity-25")}
      style={{
        left: from.x,
        top: from.y - plane.planeHeight,
        width: plane.length,
        height: plane.planeHeight,
        transformOrigin: "0 100%",
        transform: `rotateZ(${plane.angleDeg}deg) rotateX(-90deg)`,
      }}
    >
      <svg width={plane.length} height={plane.planeHeight} overflow="visible" className="block">
        <GlowFilter id={`g${uid}`} />
        <path d={plane.d} fill="none" stroke={color} strokeOpacity={highlighted ? 0.35 : 0.14} strokeWidth={highlighted ? 6 : 4} strokeLinecap="round" />
        <DrawPath
          d={plane.d}
          fill="none"
          stroke={color}
          strokeWidth={highlighted ? 2 : 1.5}
          strokeLinecap="round"
          strokeDasharray={variant === "recovered" ? "4 4" : undefined}
          instant={drawAtMs === null}
          delayMs={drawAtMs ?? 0}
        />
        <FlowParticles d={plane.d} count={particles} tier={tier} active={particlesOn} filterId={`g${uid}`} durationMs={variant === "recovered" ? 4200 : 2800} />
      </svg>
    </div>
  );
}
