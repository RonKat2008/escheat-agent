"use client";

import { formatDate } from "@/lib/format";
import { useState, type ComponentType } from "react";
import { CalendarClock } from "lucide-react";

type PopoverComponent = ComponentType<{ today: string; nextDeadline: string | null; initialOpen?: boolean }>;

const TRIGGER_CLASS =
  "inline-flex h-8 shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-2 text-[13px] text-fg-2 transition-colors duration-150 hover:bg-ink-2 hover:text-fg-1 aria-expanded:bg-ink-2";

/**
 * Demo clock: shows the simulated date; the popover fast-forwards it and recomputes timelines. The date button is plain
 * HTML in the first load; the popover (popover primitive, the clock actions) is code-split and loads on the first click,
 * which also opens it.
 */
export function DemoClock({ today, nextDeadline }: { today: string; nextDeadline: string | null }) {
  const [Popover, setPopover] = useState<PopoverComponent | null>(null);
  const [loading, setLoading] = useState(false);
  if (Popover) return <Popover today={today} nextDeadline={nextDeadline} initialOpen />;
  return (
    <button
      type="button"
      aria-label={`Demo clock, Demo date ${formatDate(today)}, open controls`}
      aria-expanded={loading}
      className={TRIGGER_CLASS}
      onClick={() => {
        setLoading(true);
        void import("./DemoClockPopover")
          .then((mod) => setPopover(() => mod.default as PopoverComponent))
          .catch(() => setLoading(false));
      }}
    >
      <CalendarClock className="size-4 text-fg-3" strokeWidth={1.5} aria-hidden />
      <span className="hidden text-fg-3 xl:inline">Demo date</span>
      {/* Whitespace keeps the visible text "Demo date Nov 1, 2026" matchable by the accessible name (flex ignores it visually). */}
      {" "}
      <span data-testid="demo-date" data-date={today} className="num text-fg-1">
        {formatDate(today)}
      </span>
    </button>
  );
}
