"use client";

import { motion, useInView, useReducedMotion } from "motion/react";
import { useRef } from "react";

/**
 * Section heading that rises out of a mask as it enters the viewport. Plays once; static under reduced motion.
 * The observer watches the (clipping) heading box, not the translated child, which would always read as clipped.
 */
export function RevealHeading({ id, className = "", children }: { id?: string; className?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLHeadingElement>(null);
  const reduce = useReducedMotion();
  const inView = useInView(ref, { once: true, margin: "0px 0px -12% 0px" });
  const shown = inView || reduce;
  return (
    <h2 id={id} ref={ref} className={`mkt-display mkt-reveal ${className}`}>
      <motion.span
        className="mkt-reveal-inner"
        initial={reduce ? false : { y: "105%" }}
        animate={{ y: shown ? 0 : "105%" }}
        transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
      >
        {children}
      </motion.span>
    </h2>
  );
}
