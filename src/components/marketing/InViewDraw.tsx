"use client";

import { createContext, useContext, useRef, type ReactNode, type SVGProps } from "react";
import { DrawPath } from "@/components/motion/DrawPath";
import { useInViewOnce } from "@/components/motion/InView";

const SeenContext = createContext(false);

interface DrawSceneProps {
  children: ReactNode;
  className?: string;
  "data-testid"?: string;
}

/**
 * Scroll-linked diagram root: its DrawLine descendants draw in (DrawPath) the first time it scrolls into view, and
 * it sets data-seen so CSS can chain node reveals after the paths (cause, then path, then effect).
 */
export function DrawScene({ children, className, "data-testid": testId }: DrawSceneProps) {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useInViewOnce(ref, { threshold: 0.3 });
  return (
    <div ref={ref} className={className} data-seen={seen} data-testid={testId}>
      <SeenContext.Provider value={seen}>{children}</SeenContext.Provider>
    </div>
  );
}

type LineProps = Pick<SVGProps<SVGPathElement>, "className" | "stroke" | "strokeWidth" | "strokeDasharray" | "strokeLinecap" | "vectorEffect"> & {
  d: string;
  delayMs?: number;
  durationMs?: number;
};

/** One path in a DrawScene: hidden until the scene is seen, then drawn once. Final immediately under reduced motion. */
export function DrawLine({ d, delayMs, durationMs, ...rest }: LineProps) {
  const seen = useContext(SeenContext);
  // Hidden by CSS (.draw-pending) only when motion is allowed; reduced motion shows the finished path at once.
  if (!seen) return <path d={d} fill="none" {...rest} className={`draw-pending ${rest.className ?? ""}`} />;
  return <DrawPath d={d} fill="none" delayMs={delayMs} durationMs={durationMs} {...rest} />;
}
