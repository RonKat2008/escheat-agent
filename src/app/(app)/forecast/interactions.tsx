"use client";

import { createContext, useContext, useEffect, useRef, useState, useTransition, type ReactNode, type TransitionStartFunction } from "react";
import { cn } from "@/lib/utils";

interface ForecastUi {
  /** Shared by every filter control, so the whole region dims while the server re-renders. */
  startTransition: TransitionStartFunction;
  /** YYYY-MM under the pointer in the chart or the table, else null. */
  activeMonth: string | null;
  setActiveMonth: (m: string | null) => void;
}

const Ctx = createContext<ForecastUi | null>(null);

export function useForecastUi(): ForecastUi {
  const ui = useContext(Ctx);
  if (!ui) throw new Error("useForecastUi must be used inside <ForecastRegion>");
  return ui;
}

/**
 * Client shell around the server-rendered forecast. It (1) dims the content while a filter change is in flight and
 * (2) cross-highlights a month between the chart and the table: hovering a table month marks the chart's bars, hovering
 * a chart month marks the table rows (data-hl on the matching tbody). The table stays server-rendered.
 */
export function ForecastRegion({ children, className }: { children: ReactNode; className?: string }) {
  const [pending, startTransition] = useTransition();
  const [activeMonth, setActiveMonth] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    for (const tb of el.querySelectorAll<HTMLElement>("tbody[data-month]")) {
      if (tb.dataset.month === activeMonth) tb.setAttribute("data-hl", "");
      else tb.removeAttribute("data-hl");
    }
  }, [activeMonth]);

  const fromTable = (target: EventTarget | null) => (target instanceof Element ? (target.closest<HTMLElement>("tbody[data-month]")?.dataset.month ?? null) : null);

  return (
    <Ctx.Provider value={{ startTransition, activeMonth, setActiveMonth }}>
      <div
        ref={root}
        aria-busy={pending}
        data-pending={pending || undefined}
        className={cn("[&[data-pending]_[data-dim]]:opacity-55 [&_[data-dim]]:transition-opacity [&_[data-dim]]:duration-200", className)}
        onMouseOver={(e) => {
          const m = fromTable(e.target);
          if (m) setActiveMonth(m);
        }}
        onMouseOut={(e) => {
          if (fromTable(e.target) && !fromTable(e.relatedTarget)) setActiveMonth(null);
        }}
      >
        {children}
      </div>
    </Ctx.Provider>
  );
}
