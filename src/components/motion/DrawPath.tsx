"use client";

import type { SVGProps } from "react";
import { m, useReducedMotion } from "motion/react";
import { DUR, EASE } from "./tokens";

type DrawPathProps = Pick<SVGProps<SVGPathElement>, "className" | "fill" | "stroke" | "strokeWidth" | "strokeLinecap" | "strokeLinejoin" | "strokeDasharray" | "opacity" | "filter" | "markerEnd" | "vectorEffect"> & {
  d: string;
  /** Start delay in ms (chain it after the source pulse, §2.2 rule 1). */
  delayMs?: number;
  durationMs?: number;
  /** Skip the draw and render the final path (revisits, the static tier). */
  instant?: boolean;
  onDrawn?: () => void;
};

/**
 * An SVG path that draws in once (pathLength 0 -> 1, --dur-draw, ease-out-expo). Fully drawn under reduced motion.
 * Render inside <MotionRoot/>.
 */
export function DrawPath({ d, delayMs = 0, durationMs = DUR.draw, instant, onDrawn, ...rest }: DrawPathProps) {
  const reduce = useReducedMotion();
  if (reduce || instant) return <path d={d} {...rest} />;
  return (
    <m.path
      d={d}
      {...rest}
      initial={{ pathLength: 0 }}
      animate={{ pathLength: 1 }}
      transition={{ duration: durationMs / 1000, delay: delayMs / 1000, ease: EASE.outExpo }}
      onAnimationComplete={onDrawn}
    />
  );
}
