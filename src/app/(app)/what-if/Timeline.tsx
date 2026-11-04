"use client";

import { useId, useRef, type PointerEvent } from "react";
import { Stage3D } from "@/components/viz/core/Stage3D";
import { useRenderTier } from "@/components/viz/core/useRenderTier";
import { addDays, type IsoDate } from "@/lib/dates";
import { formatDate } from "@/lib/format";
import { formatUSD } from "@/lib/money";
import { LANES, markState, type TimelineMark } from "@/lib/what-if/timeline-model";
import { MAX_OFFSET } from "@/lib/what-if/types";
import { cn } from "@/lib/utils";

const TICKS = [0, 90, 180, 365, 545, 730] as const;
const LANE_H = 30;
const pct = (day: number) => `${(day / MAX_OFFSET) * 100}%`;

const MARK_CLASS: Record<ReturnType<typeof markState>, string> = {
  hidden: "scale-50 opacity-0",
  missed: "scale-100 opacity-100 bg-pink-500 shadow-[0_0_10px_var(--color-pink-600)]",
  met: "scale-100 opacity-100 bg-blue-500",
  crossing: "scale-100 opacity-100 border border-blue-400 bg-ink-1",
};

function markTitle(m: TimelineMark, state: ReturnType<typeof markState>): string {
  const what = LANES[m.lane]!.label;
  const when = m.late ? "already late today" : formatDate(m.date);
  const status = state === "missed" ? `, ${m.missed} missed` : state === "met" ? ", met on time" : "";
  return `${what}, ${when}: ${m.count} ${m.count === 1 ? "item" : "items"}, ${formatUSD(m.cents)}${status}${m.unverified ? " (unverified rule)" : ""}`;
}

interface TimelineProps {
  today: string;
  offset: number;
  marks: TimelineMark[];
  onOffset: (n: number) => void;
}

export function Timeline({ today, offset, marks, onOffset }: TimelineProps) {
  const id = useId();
  const track = useRef<HTMLDivElement>(null);
  const tier = useRenderTier();
  const dragging = useRef(false);
  const at = addDays(today as IsoDate, offset);

  const fromPointer = (e: PointerEvent<HTMLDivElement>) => {
    const r = track.current?.getBoundingClientRect();
    if (!r || r.width === 0) return;
    const ratio = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    onOffset(Math.round(ratio * MAX_OFFSET));
  };
  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    fromPointer(e);
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (dragging.current) fromPointer(e);
  };
  const onUp = () => {
    dragging.current = false;
  };

  const shown = marks.map((m) => ({ m, s: markState(m, offset) }));
  const missedNow = shown.filter((x) => x.s === "missed").reduce((a, x) => a + x.m.missed, 0);

  return (
    <div className="space-y-3" data-testid="wi-timeline">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <label htmlFor={id} className="text-[13px] font-medium text-fg-1">
          Days forward
        </label>
        <output htmlFor={id} className="num text-sm text-fg-1" data-testid="wi-offset" aria-live="polite">
          +{offset} days · {formatDate(at)}
        </output>
      </div>

      <Stage3D tier={tier === "full" ? "full" : "static"} rotateX={tier === "full" ? 16 : 0} rotateZ={0} parallax={false} className="select-none">
        <div
          className="relative overflow-hidden rounded-[12px] border border-line bg-[linear-gradient(180deg,var(--color-ink-2),var(--color-ink-0))] px-3 pt-3 pb-7"
          data-testid="wi-track-frame"
        >
          <div
            ref={track}
            className="relative cursor-ew-resize touch-none"
            style={{ height: LANES.length * LANE_H }}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            aria-hidden
          >
            {LANES.map((l, i) => (
              <div key={l.kind} className="absolute inset-x-0 border-t border-line/60" style={{ top: i * LANE_H + LANE_H / 2 }}>
                <span className="absolute -top-[15px] left-0 text-[10px] tracking-[0.06em] text-fg-3 uppercase">{l.label}</span>
              </div>
            ))}
            {/* The future past the cursor is dimmed; transform only, so dragging stays on the compositor. */}
            <div
              className="pointer-events-none absolute inset-y-0 right-0 left-0 origin-right bg-ink-0/55"
              style={{ transform: `scaleX(${1 - offset / MAX_OFFSET})` }}
            />
            {shown.map(({ m, s }) => (
              <span
                key={m.key}
                data-testid="wi-mark"
                data-kind={m.kind}
                data-state={s}
                title={markTitle(m, s)}
                className={cn(
                  "absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none",
                  MARK_CLASS[s],
                  m.count > 2 && "size-3.5",
                )}
                style={{ left: pct(m.day), top: m.lane * LANE_H + LANE_H / 2 }}
              />
            ))}
            <div className="pointer-events-none absolute inset-y-[-6px] w-px bg-blue-400" style={{ left: pct(offset) }} data-testid="wi-cursor">
              <span className="absolute -top-1 left-1/2 size-2.5 -translate-x-1/2 rotate-45 bg-blue-400" />
            </div>
          </div>
          <div className="absolute inset-x-3 bottom-1.5 h-4 text-[10px] text-fg-3" aria-hidden>
            {TICKS.map((t) => (
              <span key={t} className={cn("num absolute", t === 0 ? "left-0" : t === MAX_OFFSET ? "right-0" : "-translate-x-1/2", t !== 0 && t !== 365 && t !== MAX_OFFSET && "hidden sm:inline")} style={t === 0 || t === MAX_OFFSET ? undefined : { left: pct(t) }}>
                {t === 0 ? "Today" : formatDate(addDays(today as IsoDate, t)).replace(/ \d+, \d{2}(\d{2})$/, " ’$1")}
              </span>
            ))}
          </div>
        </div>
      </Stage3D>

      <input
        id={id}
        type="range"
        min={0}
        max={MAX_OFFSET}
        step={1}
        value={offset}
        onChange={(e) => onOffset(Number(e.target.value))}
        aria-valuetext={`plus ${offset} days, ${formatDate(at)}`}
        className="w-full accent-blue-500"
      />
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-3" data-testid="wi-legend">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-full bg-pink-500" /> Missed: a human must act ({missedNow})
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-full bg-blue-500" /> Met on time
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-full border border-blue-400" /> Crossed
        </span>
        <span>Drag the track or use the slider; dates past the cursor stay hidden.</span>
      </p>
    </div>
  );
}
