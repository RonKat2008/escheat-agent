"use client";

import { formatDate } from "@/lib/format";
import { useState, type ComponentType } from "react";
import { CalendarClock } from "lucide-react";
import { CLOCK_BUTTON } from "./chrome";

type PopoverComponent = ComponentType<{ today: string; nextDeadline: string | null; initialOpen?: boolean }>;

const TRIGGER_CLASS = CLOCK_BUTTON;

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
      <CalendarClock className="size-4" strokeWidth={1.75} aria-hidden />
      <span className="hidden text-ink-3 2xl:inline">Demo date</span>
      {/* Whitespace keeps the visible text "Demo date Nov 1, 2026" matchable by the accessible name (flex ignores it visually). */}
      {" "}
      <span data-testid="demo-date" data-date={today} className="num font-medium">
        {formatDate(today)}
      </span>
    </button>
  );
}
