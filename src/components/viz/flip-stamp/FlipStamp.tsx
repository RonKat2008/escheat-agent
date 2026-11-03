"use client";

import { m } from "motion/react";
import type { ReactNode } from "react";
import { SPRING } from "@/components/motion/tokens";
import { useRenderTier } from "@/components/viz/core/useRenderTier";
import { cn } from "@/lib/utils";

export interface FlipStampProps {
  /** The face shown before approval. */
  front: ReactNode;
  /** The face shown after approval (the stamp lands on it). */
  back: ReactNode;
  /** Show the back face. */
  flipped: boolean;
  /** Play the flip (true right after this viewer approved). False renders the final state with no motion. */
  animate: boolean;
  className?: string;
}

/**
 * The approval "gate" moment (DESIGN-V3 §3.4): a CSS 3D card flip (rotateY 0 → 180°, sheet spring), then the
 * "Approved" stamp lands with the stamp spring. Under the static render tier (reduced motion) it is an instant state
 * change. Only the visible face is exposed to assistive tech.
 */
export function FlipStamp({ front, back, flipped, animate, className }: FlipStampProps) {
  const tier = useRenderTier();
  const play = animate && tier !== "static";
  return (
    <div className={cn("relative [perspective:900px]", className)} data-testid="flip-stamp" data-flipped={flipped ? "true" : "false"}>
      <m.div
        className="relative grid [transform-style:preserve-3d]"
        initial={false}
        animate={{ rotateY: flipped ? 180 : 0 }}
        transition={play ? SPRING.sheet : { duration: 0 }}
      >
        <div aria-hidden={flipped} className="[grid-area:1/1] [backface-visibility:hidden]">
          {front}
        </div>
        <div aria-hidden={!flipped} className="[grid-area:1/1] [transform:rotateY(180deg)] [backface-visibility:hidden]">
          {back}
        </div>
      </m.div>
    </div>
  );
}

/** The stamp mark. Lands with the stamp spring (the only overshoot in the app) when `land` is true. */
export function Stamp({ land, children, className }: { land: boolean; children: ReactNode; className?: string }) {
  const tier = useRenderTier();
  const play = land && tier !== "static";
  return (
    <m.span
      data-testid="approved-stamp"
      className={cn(
        "inline-flex -rotate-6 items-center gap-1.5 rounded-[4px] border-2 border-blue-400 px-2 py-0.5 font-mono text-[13px] font-semibold tracking-[0.12em] text-blue-300 uppercase",
        className,
      )}
      initial={play ? { scale: 1.6, opacity: 0 } : false}
      animate={{ scale: 1, opacity: 1 }}
      transition={play ? { ...SPRING.stamp, delay: 0.32 } : { duration: 0 }}
    >
      {children}
    </m.span>
  );
}
