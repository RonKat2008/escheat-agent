"use client";

import { useRef, type CSSProperties, type ReactNode, type SVGProps } from "react";
import { useInViewOnce } from "@/components/motion/InView";
import { drawAxis } from "./draw-axis";

interface DrawSceneProps {
  children: ReactNode;
  className?: string;
  "data-testid"?: string;
}

/**
 * Scroll-linked diagram root: its DrawLine descendants draw in the first time it scrolls into view, and it sets
 * data-seen so CSS can chain node reveals after the paths (cause, then path, then effect). Pure CSS (no motion
 * library on the marketing pages): marketing.css scales each line from its start under `[data-seen="true"]`.
 */
export function DrawScene({ children, className, "data-testid": testId }: DrawSceneProps) {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useInViewOnce(ref, { threshold: 0.3 });
  return (
    <div ref={ref} className={className} data-seen={seen} data-testid={testId}>
      {children}
    </div>
  );
}

type LineProps = Pick<SVGProps<SVGPathElement>, "className" | "stroke" | "strokeWidth" | "strokeLinecap" | "vectorEffect"> & {
  /** A straight horizontal (`M x y H x2`) or vertical (`M x y V y2`) line; it draws from its start point. */
  d: string;
  delayMs?: number;
  durationMs?: number;
};

const DEFAULT_DRAW_MS = 900;

/**
 * One line in a DrawScene: hidden until the scene is seen, then drawn once (a scale from its start point, on the
 * compositor). Under reduced motion (OS or in-app) the CSS shows the finished line at once.
 */
export function DrawLine({ d, delayMs = 0, durationMs = DEFAULT_DRAW_MS, className, ...rest }: LineProps) {
  const style = { "--draw-delay": `${delayMs}ms`, "--draw-dur": `${durationMs}ms` } as CSSProperties;
  return <path d={d} fill="none" {...rest} className={`draw-line ${className ?? ""}`} data-axis={drawAxis(d)} style={style} />;
}
