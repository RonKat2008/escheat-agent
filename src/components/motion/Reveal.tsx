"use client";

import { Children, type ReactNode } from "react";
import { m, useReducedMotion } from "motion/react";
import { DUR_S, EASE, STAGGER } from "./tokens";

interface RevealProps {
  children: ReactNode;
  className?: string;
  /** Distance in px the content rises from (default 16, the section reveal in §6.1). */
  y?: number;
  /** Delay in ms before it starts. */
  delayMs?: number;
  /** Duration in ms (default 700, ease-out-expo). */
  durationMs?: number;
  as?: "div" | "section" | "li";
}

/**
 * Plays once when the element first scrolls into view: opacity + translateY, ease-out-expo. Must render inside
 * <MotionRoot/> (LazyMotion strict). Under reduced motion it renders final with no motion.
 */
export function Reveal({ children, className, y = 16, delayMs = 0, durationMs = 700, as = "div" }: RevealProps) {
  const reduce = useReducedMotion();
  const Tag = m[as];
  if (reduce) return <Tag className={className}>{children}</Tag>;
  return (
    <Tag
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "0px 0px -8% 0px" }}
      transition={{ duration: durationMs / 1000, delay: delayMs / 1000, ease: EASE.outExpo }}
    >
      {children}
    </Tag>
  );
}

interface StaggerProps {
  children: ReactNode;
  className?: string;
  /** "list" = 30ms apart, capped at 8; "nodes" = 60ms apart, capped at 10 (§2.2 rule 3). */
  kind?: "list" | "nodes";
  as?: "div" | "ul" | "ol";
}

/** Staggered entrance for direct children (rise 6px + fade, --dur-base). Final under reduced motion. */
export function Stagger({ children, className, kind = "list", as = "div" }: StaggerProps) {
  const reduce = useReducedMotion();
  const Tag = m[as];
  const step = kind === "list" ? STAGGER.listMs : STAGGER.nodeMs;
  const cap = kind === "list" ? STAGGER.listCap : STAGGER.nodeCap;
  const Item = as === "div" ? m.div : m.li;
  return (
    <Tag className={className}>
      {Children.toArray(children).map((child, i) =>
        reduce ? (
          <Item key={i}>{child}</Item>
        ) : (
          <Item
            key={i}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: DUR_S.base, ease: EASE.out, delay: (Math.min(i, cap) * step) / 1000 }}
          >
            {child}
          </Item>
        ),
      )}
    </Tag>
  );
}
