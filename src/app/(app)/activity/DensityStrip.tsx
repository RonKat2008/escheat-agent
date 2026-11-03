"use client";

import { useId, useRef, useState, type MouseEvent } from "react";
import { InstrumentLabel } from "@/components/primitives/v3";
import { SrTable } from "@/components/viz/core/SrTable";
import { useRenderTier } from "@/components/viz/core/useRenderTier";
import { VizTooltip } from "@/components/viz/core/VizTooltip";
import { cn } from "@/lib/utils";
import { dayAnchorId, type SeismoDay } from "./density-model";

const SHORT = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
const shortDay = (iso: string) => SHORT.format(new Date(`${iso}T00:00:00Z`));
const entries = (n: number) => `${n} ${n === 1 ? "entry" : "entries"}`;

function dayLabel(d: SeismoDay): string {
  const parts = [`${shortDay(d.day)}: ${entries(d.count)}`];
  if (d.human) parts.push(`${d.human} approval${d.human === 1 ? "" : "s"} by a person`);
  if (d.attention) parts.push(`${d.attention} needing attention`);
  return parts.join(", ");
}

export interface DensityStripProps {
  days: SeismoDay[];
  /** Filter link per day (the no-JS path, and the path for days older than the loaded feed). */
  hrefs: Record<string, string>;
  from: string;
  to: string;
  total: number;
  caption: string;
  /** Days outside a chosen From/To range are shaded, not removed. */
  shaded: string[];
}

/**
 * The 30-day "seismograph" (§4.5, §6.8): one column per recorded (UTC) day. The trace above the line is every entry
 * (blue); the trace below is approvals a person gave (pink). Clicking a day that is in the loaded feed scrolls the feed
 * to that day (smooth, instant under reduced motion); an older day keeps its link and filters to that day.
 */
export function DensityStrip({ days, hrefs, from, to, total, caption, shaded }: DensityStripProps) {
  const tier = useRenderTier();
  const tipId = `strip-tip-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const wrap = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ d: SeismoDay; x: number } | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const shadedSet = new Set(shaded);
  const animate = tier !== "static";

  const show = (d: SeismoDay, el: Element) => {
    const box = wrap.current?.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (!box) return;
    const x = Math.min(Math.max(r.left + r.width / 2 - box.left, 96), box.width - 96);
    setTip({ d, x });
  };
  const hide = (d: SeismoDay) => setTip((t) => (t?.d.day === d.day ? null : t));

  const onDayClick = (e: MouseEvent<HTMLAnchorElement>, d: SeismoDay) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    const target = document.getElementById(dayAnchorId(d.day));
    if (!target) return; // not in the loaded feed: follow the filter link
    e.preventDefault();
    target.scrollIntoView({ behavior: animate ? "smooth" : "auto", block: "start" });
    target.focus({ preventScroll: true });
    setCurrent(d.day);
  };

  return (
    <section aria-labelledby="activity-strip-h" data-testid="activity-strip" className="mb-10">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <InstrumentLabel as="p" className="mb-1">
            Activity, last 30 recorded days
          </InstrumentLabel>
          <h2 id="activity-strip-h" className="text-[13px] text-fg-2">
            <span className="num text-[28px] leading-8 font-medium tracking-[-0.02em] text-fg-1">{total}</span>{" "}
            {total === 1 ? "entry" : "entries"} from {shortDay(from)} to {shortDay(to)}
          </h2>
        </div>
        <p className="text-xs text-fg-3">{caption}</p>
      </div>
      <div ref={wrap} className="relative">
        <div className="relative flex h-[76px] items-stretch gap-[3px] rounded-[10px] border border-line bg-ink-1 px-3">
          <span aria-hidden className="pointer-events-none absolute inset-x-3 top-1/2 h-px bg-line-strong" />
          {days.map((d, i) => {
            const label = dayLabel(d);
            const dim = shadedSet.has(d.day);
            const bars = (
              <>
                <span aria-hidden className="absolute inset-x-[-1.5px] inset-y-1 rounded-[3px] bg-transparent transition-colors duration-150 group-hover/day:bg-ink-3" />
                <span aria-hidden className="relative flex h-1/2 items-end justify-center">
                  <span
                    className={cn("w-full max-w-[10px] rounded-t-[2px] bg-blue-500 transition-colors duration-150 group-hover/day:bg-blue-400", animate && "es-grow-y")}
                    style={{ height: `${d.up}%`, ["--i" as string]: i }}
                  />
                </span>
                <span aria-hidden className="relative flex h-1/2 items-start justify-center">
                  {d.down > 0 ? (
                    <span
                      className={cn("w-full max-w-[10px] origin-top rounded-b-[2px] bg-pink-500", animate && "es-grow-y")}
                      style={{ height: `${d.down}%`, transformOrigin: "center top", ["--i" as string]: i }}
                    />
                  ) : null}
                </span>
              </>
            );
            if (d.count === 0) {
              return (
                <span
                  key={d.day}
                  className={cn("group/day relative flex flex-1 flex-col py-2", dim && "opacity-35")}
                  onPointerEnter={(e) => show(d, e.currentTarget)}
                  onPointerLeave={() => hide(d)}
                >
                  <span aria-hidden className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded-[1px] bg-line-hover" />
                </span>
              );
            }
            return (
              <a
                key={d.day}
                href={hrefs[d.day]}
                aria-label={`Show ${label}`}
                aria-describedby={tip?.d.day === d.day ? tipId : undefined}
                aria-current={current === d.day ? "location" : undefined}
                data-testid="activity-strip-day"
                data-day={d.day}
                data-in-feed={d.inFeed || undefined}
                className={cn(
                  "group/day relative flex flex-1 flex-col py-2 outline-none focus-visible:rounded-[3px] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-400",
                  dim && "opacity-35",
                  current === d.day && "[&>span:first-child]:bg-ink-4",
                )}
                onClick={(e) => onDayClick(e, d)}
                onPointerEnter={(e) => show(d, e.currentTarget)}
                onPointerLeave={() => hide(d)}
                onFocus={(e) => show(d, e.currentTarget)}
                onBlur={() => hide(d)}
              >
                {bars}
              </a>
            );
          })}
        </div>
        {tip ? (
          <VizTooltip open id={tipId} x={tip.x} y={0}>
            <span className="block font-medium">{shortDay(tip.d.day)}</span>
            <span className="block text-fg-2">{entries(tip.d.count)}</span>
            {tip.d.human ? <span className="block text-pink-300">{tip.d.human} approved by a person</span> : null}
            {tip.d.attention ? <span className="block text-pink-300">{tip.d.attention} need attention</span> : null}
            {tip.d.count > 0 ? <span className="block text-fg-3">{tip.d.inFeed ? "Click to jump to this day" : "Click to filter to this day"}</span> : null}
          </VizTooltip>
        ) : null}
      </div>
      <div className="mt-1.5 flex flex-wrap justify-between gap-x-4 px-3 text-[11px] text-fg-3">
        <span aria-hidden>{shortDay(from)}</span>
        <span className="inline-flex items-center gap-3 max-sm:order-last max-sm:w-full max-sm:justify-center">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-2.5 w-1.5 rounded-t-[1px] bg-blue-500" />
            Entries
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-2.5 w-1.5 rounded-b-[1px] bg-pink-500" />
            Approved by a person
          </span>
          <span>Recorded dates, UTC</span>
        </span>
        <span aria-hidden>{shortDay(to)}</span>
      </div>
      <SrTable
        caption={`Entries per recorded day, ${shortDay(from)} to ${shortDay(to)} (UTC)`}
        columns={["Day", "Entries", "Approved by a person", "Needing attention"]}
        rows={days.map((d) => [shortDay(d.day), String(d.count), String(d.human), String(d.attention)])}
      />
    </section>
  );
}
