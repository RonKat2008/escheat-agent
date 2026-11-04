"use client";

import { useMemo, useRef, type CSSProperties, type KeyboardEvent } from "react";
import { SrTable, Stage3D, useRenderTier, VIZ } from "@/components/viz/core";
import { buildRings, layoutDots, makeScale, motionFor, round4, type RadarRing, type RingInput } from "./radar-model";
import "./radar.css";

const TILT_DEG = 50;
/** Within this many days of the stale line a dot turns pink: a person should act now. */
export const ACT_NOW_DAYS = 30;

export interface RadarItem {
  id: string;
  /** Accessible name for the dot (payee, amount, timing). */
  label: string;
  ageDays: number;
  amountCents: number;
  /** Days until stale at the demo clock (scrubber offset not applied). */
  daysUntilStale: number;
  datesKnown: boolean;
}

export interface HorizonRadarProps {
  items: readonly RadarItem[];
  thresholdDays: number;
  dormancy: readonly RingInput[];
  offsetDays: number;
  activeId: string | null;
  onActive: (id: string | null) => void;
  /** Visually hidden table twin. */
  table: { caption: string; columns: string[]; rows: string[][] };
  /** Text summary for the region (also the SR description). */
  summary: string;
}

function dotColor(daysUntilStale: number): string {
  if (daysUntilStale <= ACT_NOW_DAYS) return VIZ.pink500;
  return daysUntilStale <= 90 ? VIZ.blue400 : VIZ.blue600;
}

/** Labels alternate either side of 6 o'clock so neighbouring rings never stack their labels. */
const LABEL_SPREAD_DEG = 20;

function RingLabel({ ring, counter, index }: { ring: RadarRing; counter: string; index: number }) {
  // The stale line (the one AP acts on) is labelled at 12 o'clock; the others alternate around 6 o'clock.
  const deg = ring.kind === "stale" ? -90 : 90 + (index % 2 === 0 ? 1 : -1) * LABEL_SPREAD_DEG;
  const a = (deg * Math.PI) / 180;
  const tone = ring.kind === "stale" ? "text-fg-1" : ring.kind === "dormancy" ? "text-blue-300" : "text-fg-3";
  return (
    <span className={ring.kind === "mid" ? "hr-ring-label max-sm:hidden" : "hr-ring-label"} style={{ "--lx": round4(Math.cos(a) * ring.r), "--ly": round4(Math.sin(a) * ring.r), "--counter": counter } as CSSProperties} data-ring={ring.kind}>
      <span className={`flex flex-col items-center rounded-[5px] bg-ink-0/80 px-1.5 py-0.5 text-center leading-tight ${tone}`}>
        <span className="font-mono text-[10px] tracking-[0.06em] uppercase sm:text-[11px]">{ring.label}</span>
        <span className="flex items-center gap-1 text-[10px] text-fg-3">
          <span className={ring.kind === "dormancy" ? "max-sm:hidden" : undefined}>{ring.note}</span>
          {ring.unverified ? (
            <span data-testid="ring-unverified" className="rounded-[3px] border border-line-strong px-1 font-mono text-[9px] tracking-[0.08em] text-fg-2">
              UNVERIFIED
            </span>
          ) : null}
        </span>
      </span>
    </span>
  );
}

/**
 * The Pre-stale Horizon: a tilted radar of concentric rings (issued, mid, the business stale threshold, and each state's
 * presumed-abandoned point from the rules engine). Every dot is an outstanding payment sized by amount; the scrubber
 * offset moves dots outward along their spoke. Tiers: full = tilt + sweep + gliding dots; lite = tilt + gliding dots;
 * static (reduced motion, SSR) = a flat, motionless SVG plane with the same dots and labels. Dots use a roving tabindex.
 */
export function HorizonRadar({ items, thresholdDays, dormancy, offsetDays, activeId, onActive, table, summary }: HorizonRadarProps) {
  const tier = useRenderTier();
  const motion = motionFor(tier);
  const scale = useMemo(() => makeScale(thresholdDays, dormancy.map((d) => d.days)), [thresholdDays, dormancy]);
  const rings = useMemo(() => buildRings(scale, dormancy), [scale, dormancy]);
  const dots = useMemo(() => layoutDots(items, scale, offsetDays), [items, scale, offsetDays]);
  const counter = motion.tilt ? `${-TILT_DEG}deg` : "0deg";
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const activeIdx = Math.max(0, items.findIndex((i) => i.id === activeId));

  const move = (e: KeyboardEvent<HTMLButtonElement>, idx: number) => {
    const last = items.length - 1;
    const next =
      e.key === "ArrowRight" || e.key === "ArrowDown" ? (idx === last ? 0 : idx + 1)
      : e.key === "ArrowLeft" || e.key === "ArrowUp" ? (idx === 0 ? last : idx - 1)
      : e.key === "Home" ? 0
      : e.key === "End" ? last
      : null;
    if (next === null) {
      if (e.key === "Escape") onActive(null);
      return;
    }
    e.preventDefault();
    onActive(items[next]!.id);
    refs.current[next]?.focus();
  };

  return (
    <figure className="m-0" data-testid="horizon-radar" data-tier={tier} aria-label="Pre-stale horizon radar">
      <figcaption className="sr-only">{summary}</figcaption>
      {/* A tilted square projects to roughly cos(tilt) of its height: pull the empty bands in so the stage hugs the plane. */}
      <div className="mx-auto w-full max-w-[640px] px-2 sm:px-6" style={{ marginBlock: motion.tilt ? "-14%" : 0 }}>
        <Stage3D tier={tier} rotateX={motion.tilt ? TILT_DEG : 0} rotateZ={0} parallax={tier === "full"} perspective={1600}>
          <div className="hr-plane" data-testid="horizon-plane">
            <svg className="hr-svg" viewBox="-1 -1 2 2" aria-hidden focusable="false">
              {/* the band where AP can still act (issued -> stale) */}
              <circle r={rings.find((r) => r.kind === "stale")?.r ?? 0.5} fill={VIZ.blue900} fillOpacity={0.35} />
              {[0, 45, 90, 135].map((deg) => (
                <line
                  key={deg}
                  x1={round4(-Math.cos((deg * Math.PI) / 180) * 0.95)}
                  y1={round4(-Math.sin((deg * Math.PI) / 180) * 0.95)}
                  x2={round4(Math.cos((deg * Math.PI) / 180) * 0.95)}
                  y2={round4(Math.sin((deg * Math.PI) / 180) * 0.95)}
                  stroke={VIZ.grid}
                  strokeWidth={0.003}
                />
              ))}
              {rings.map((r) => (
                <circle
                  key={r.key}
                  r={r.r}
                  fill="none"
                  stroke={r.kind === "stale" ? VIZ.fg1 : r.kind === "dormancy" ? VIZ.blue400 : VIZ.lineStrong}
                  strokeWidth={r.kind === "stale" ? 0.008 : 0.004}
                  strokeDasharray={r.kind === "dormancy" ? "0.02 0.015" : r.kind === "mid" ? "0.006 0.012" : undefined}
                  data-ring={r.kind}
                  data-days={r.days}
                />
              ))}
              <circle r={0.018} fill={VIZ.blue300} />
            </svg>
            {motion.sweep ? <div className="hr-sweep" data-on="true" aria-hidden /> : null}
            <div aria-hidden className="hr-layer">
              {rings
                .filter((r) => r.kind !== "issued")
                .map((r, i) => (
                  <RingLabel key={r.key} ring={r} counter={counter} index={i} />
                ))}
            </div>
            <div className="hr-layer" role="group" aria-label="Outstanding payments, sized by amount. Use arrow keys to move between them.">
              {dots.map((d, idx) => {
                const it = items[idx]!;
                const until = Math.max(0, it.daysUntilStale - offsetDays);
                const color = dotColor(until);
                const active = activeId === it.id;
                return (
                  <button
                    key={d.id}
                    ref={(el) => {
                      refs.current[idx] = el;
                    }}
                    type="button"
                    className="hr-dot"
                    data-testid="horizon-dot"
                    data-id={it.id}
                    data-active={active}
                    data-unknown={!it.datesKnown}
                    data-anim={motion.transitions}
                    tabIndex={idx === activeIdx ? 0 : -1}
                    aria-label={it.label}
                    aria-pressed={active}
                    style={{ "--x": d.x, "--y": d.y, "--size": `${d.size}px`, "--dot": color, "--counter": counter } as CSSProperties}
                    onPointerEnter={() => onActive(it.id)}
                    onFocus={() => onActive(it.id)}
                    onClick={() => onActive(it.id)}
                    onKeyDown={(e) => move(e, idx)}
                  >
                    {motion.tilt && until <= ACT_NOW_DAYS ? <span className="hr-beam" aria-hidden /> : null}
                  </button>
                );
              })}
            </div>
          </div>
        </Stage3D>
      </div>
      <SrTable caption={table.caption} columns={table.columns} rows={table.rows} />
    </figure>
  );
}
