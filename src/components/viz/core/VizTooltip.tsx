import type { ReactNode } from "react";

export interface VizTooltipProps {
  open: boolean;
  /** Pixel position within the nearest positioned ancestor. */
  x: number;
  y: number;
  id: string;
  children: ReactNode;
}

/** Lightweight tooltip. Place inside a `relative` container; point it at via aria-describedby. */
export function VizTooltip({ open, x, y, id, children }: VizTooltipProps) {
  return (
    <div
      id={id}
      role="tooltip"
      hidden={!open}
      className="pointer-events-none absolute z-20 max-w-[16rem] rounded-sm border border-line-strong bg-ink-3 px-2 py-1 text-[12px] leading-snug text-fg-1"
      style={{ left: x, top: y, transform: "translate(-50%, calc(-100% - 8px))" }}
    >
      {children}
    </div>
  );
}
