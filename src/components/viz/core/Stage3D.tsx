"use client";

import { m, useMotionValue, useSpring, useTransform } from "motion/react";
import { useState, type PointerEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { RenderTier } from "./render-tier";
import { useRenderTier } from "./useRenderTier";

/** Mirrors SPRING.camera in motion/tokens (kept local so viz/core has no cross-slice dependency). */
const CAMERA_SPRING = { stiffness: 120, damping: 26, mass: 1.2 } as const;
const PARALLAX_DEG = 4;

export interface Stage3DProps {
  perspective?: number;
  rotateX?: number;
  rotateZ?: number;
  /** Pointer parallax of +/-4 degrees (tier "full" only). */
  parallax?: boolean;
  tier?: RenderTier;
  children: ReactNode;
  className?: string;
  "aria-label"?: string;
}

export function Stage3D({
  perspective = 1400,
  rotateX = 54,
  rotateZ = -8,
  parallax = true,
  tier: tierProp,
  children,
  className,
  "aria-label": ariaLabel,
}: Stage3DProps) {
  const detected = useRenderTier();
  const tier = tierProp ?? detected;
  const flat = tier === "static";
  const live = tier === "full" && parallax;

  const [hovering, setHovering] = useState(false);
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const sx = useSpring(px, CAMERA_SPRING);
  const sy = useSpring(py, CAMERA_SPRING);
  const baseX = flat ? 0 : rotateX;
  const baseZ = flat ? 0 : rotateZ;
  const rx = useTransform(sy, (v) => baseX - v * PARALLAX_DEG);
  const rz = useTransform(sx, (v) => baseZ + v * PARALLAX_DEG);

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!live) return;
    const r = e.currentTarget.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    px.set(((e.clientX - r.left) / r.width) * 2 - 1);
    py.set(((e.clientY - r.top) / r.height) * 2 - 1);
  };
  const onEnter = () => setHovering(true);
  const onLeave = () => {
    setHovering(false);
    px.set(0);
    py.set(0);
  };

  return (
    <div
      className={cn("relative", className)}
      data-tier={tier}
      role={ariaLabel ? "group" : undefined}
      aria-label={ariaLabel}
      style={{ perspective: flat ? "none" : `${perspective}px` }}
      onPointerMove={live ? onMove : undefined}
      onPointerEnter={live ? onEnter : undefined}
      onPointerLeave={live ? onLeave : undefined}
    >
      <m.div
        className="relative"
        style={{
          transformStyle: "preserve-3d",
          rotateX: live ? rx : baseX,
          rotateZ: live ? rz : baseZ,
          willChange: hovering ? "transform" : undefined,
        }}
      >
        {children}
      </m.div>
    </div>
  );
}
