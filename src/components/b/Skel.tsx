import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

/** Placeholder block on the ink-3 surface. Opacity-only pulse; static under reduced motion. */
export function Skel({ className, style }: { className?: string; style?: CSSProperties }) {
  return <div aria-hidden className={cn("animate-pulse rounded-[6px] bg-ink-3 motion-reduce:animate-none", className)} style={style} />;
}
