"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import "./motion.css";

const DEFAULT_MARGIN = "0px 0px -8% 0px";

/**
 * True once the element has been at least `threshold` visible. Never flips back: reveals play on the first view only.
 * Server render and the first client render are false, so hydration matches.
 */
export function useInViewOnce<T extends Element>(ref: RefObject<T | null>, { rootMargin = DEFAULT_MARGIN, threshold = 0.15 } = {}): boolean {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          io.disconnect();
        }
      },
      { rootMargin, threshold },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, rootMargin, threshold, seen]);
  return seen;
}

/**
 * Marks its subtree data-inview="false" until first seen, then "true". Descendants opt in with the
 * es-iv-grow-x / es-iv-grow-y / es-iv-fade classes (motion.css) and an optional --i stagger index.
 * Reduced motion or no scripting: those classes do nothing and content renders final.
 */
export function InView({
  children,
  className,
  style,
  as: Tag = "div",
  threshold,
  "data-testid": testId,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  as?: "div" | "section" | "figure" | "dd" | "dl";
  threshold?: number;
  "data-testid"?: string;
}) {
  const ref = useRef<HTMLElement>(null);
  const seen = useInViewOnce(ref, { threshold });
  return (
    <Tag ref={ref as RefObject<never>} data-inview={seen ? "true" : "false"} data-testid={testId} className={className} style={style}>
      {children}
    </Tag>
  );
}
