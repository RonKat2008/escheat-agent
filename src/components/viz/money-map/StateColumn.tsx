"use client";

import Link from "next/link";
import type { CSSProperties, KeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import { columnName } from "./map-model";
import type { MapStateDatum } from "./types";

export interface StateColumnProps {
  d: MapStateDatum;
  /** 0..1 position on the floor. */
  left: number;
  top: number;
  heightPx: number;
  hollow: boolean;
  /** Flat 2D map (static tier): a bar instead of a 3D box, labels upright with no counter-rotation. */
  flat: boolean;
  /** The plane's tilt, undone on the label so it faces the camera. */
  tilt: { x: number; z: number };
  /** First-visit choreography: when the column grows (ms after mount). null = render final. */
  riseAtMs: number | null;
  active: boolean;
  dimmed: boolean;
  compact: boolean;
  describedBy?: string;
  onActivate: (state: string | null) => void;
  onArrow: (e: KeyboardEvent<HTMLAnchorElement>) => void;
}

const FACE = "absolute border border-blue-400/30";

/** A CSS 3D box: four faces and a top, built from divs (DESIGN-V3 §3.2). Faces stand up out of the floor. */
function Box({ h, w, hollow, urgent }: { h: number; w: number; hollow: boolean; urgent: boolean }) {
  if (hollow) {
    return <div aria-hidden className="absolute inset-0 rounded-[2px] border border-dashed border-fg-4" />;
  }
  const side: CSSProperties = { width: w, height: h };
  return (
    <>
      {/* south face hangs from the bottom edge and folds up */}
      <div aria-hidden className={cn(FACE, "bg-blue-600/85")} style={{ ...side, left: 0, top: w, transformOrigin: "50% 0", transform: "rotateX(90deg)" }} />
      <div aria-hidden className={cn(FACE, "bg-blue-800/90")} style={{ ...side, left: 0, top: -h, transformOrigin: "50% 100%", transform: "rotateX(-90deg)" }} />
      <div aria-hidden className={cn(FACE, "bg-blue-700/90")} style={{ width: h, height: w, left: w, top: 0, transformOrigin: "0 50%", transform: "rotateY(-90deg)" }} />
      <div aria-hidden className={cn(FACE, "bg-blue-700/80")} style={{ width: h, height: w, left: -h, top: 0, transformOrigin: "100% 50%", transform: "rotateY(90deg)" }} />
      <div aria-hidden className="absolute inset-0 bg-blue-300" style={{ transform: `translateZ(${h}px)` }} />
      {/* The gate ring: something in this state is due within 7 days (pink = a person is needed). */}
      {urgent ? (
        <div aria-hidden className="absolute -inset-[7px] rounded-full border-2 border-pink-500" style={{ transform: `translateZ(${h + 1}px)` }} />
      ) : null}
    </>
  );
}

/** One state's exposure column with its label. The label is the link (role link, full accessible name). */
export function StateColumn({ d, left, top, heightPx, hollow, flat, tilt, riseAtMs, active, dimmed, compact, describedBy, onActivate, onArrow }: StateColumnProps) {
  const w = compact ? 12 : 16;
  const urgent = d.urgent > 0;
  const name = columnName({ name: d.name, formatted: d.formatted, count: d.count, urgent: d.urgent, unverified: d.unverified });
  const playing = riseAtMs !== null;
  const labelDelay: CSSProperties | undefined = playing ? { animationDelay: `${riseAtMs + 260}ms` } : undefined;
  const onFocus = () => onActivate(d.state);

  const label = (
    <Link
      href={d.href}
      data-testid={`state-tile-${d.state}`}
      data-map-col={d.state}
      aria-describedby={active ? describedBy : undefined}
      onPointerEnter={() => onActivate(d.state)}
      onPointerLeave={() => onActivate(null)}
      onFocus={onFocus}
      onBlur={() => onActivate(null)}
      onKeyDown={onArrow}
      className={cn(
        "block rounded-[6px] border bg-ink-1/90 text-left whitespace-nowrap backdrop-blur-[2px] transition-colors duration-150",
        compact ? "px-1.5 py-0.5" : "px-2 py-1",
        active ? "border-blue-400" : urgent ? "border-pink-500/70" : "border-line-strong",
        playing && "es-col-label",
      )}
      style={labelDelay}
    >
      <span className="flex items-baseline gap-1.5">
        <span className={cn("font-mono font-medium tracking-[0.08em] text-fg-1", compact ? "text-[10px]" : "text-[11px]")}>{d.state}</span>
        <span className={cn("num font-medium tracking-[-0.01em] text-fg-1", compact ? "text-[12px]" : "text-[14px]")}>{d.short}</span>
      </span>
      <span className={cn("flex items-center gap-1.5 text-fg-2", compact ? "text-[10px]" : "text-[11px]")}>
        <span className="num">
          {d.count} {d.count === 1 ? "item" : "items"}
        </span>
        {urgent ? <span className="num text-pink-400">{d.urgent} due ≤7d</span> : null}
      </span>
      {d.unverified && !compact ? (
        <span className="mt-0.5 inline-block rounded-[2px] border border-line-strong px-1 font-mono text-[9px] tracking-[0.06em] text-fg-2">UNVERIFIED</span>
      ) : null}
      {/* Full figures for assistive tech; the name starts with the visible text (WCAG 2.5.3 label in name). */}
      <span className="sr-only" data-col-name>{`, ${name}`}</span>
    </Link>
  );

  if (flat) {
    return (
      <div className={cn("absolute transition-opacity duration-150", dimmed && "opacity-40")} style={{ left: `${left * 100}%`, top: `${top * 100}%` }}>
        {hollow ? (
          <span aria-hidden className="absolute block size-3 -translate-x-1/2 -translate-y-1/2 rounded-[2px] border border-dashed border-fg-4" />
        ) : (
          <span
            aria-hidden
            className={cn("absolute block rounded-t-[2px] bg-blue-500", playing && "es-bar-rise")}
            style={{ width: w - 4, height: heightPx, transform: "translate(-50%, -100%)", animationDelay: playing ? `${riseAtMs}ms` : undefined }}
          />
        )}
        {urgent ? <span aria-hidden className="absolute block size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-pink-500" /> : null}
        <div className="absolute z-10 -translate-x-1/2" style={{ bottom: heightPx + 6 }}>
          {label}
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn("absolute transition-opacity duration-150", dimmed && "opacity-40")}
      style={{ left: `${left * 100}%`, top: `${top * 100}%`, width: w, height: w, marginLeft: -w / 2, marginTop: -w / 2, transformStyle: "preserve-3d" }}
    >
      <div
        className={cn("absolute inset-0", playing && "es-col-rise")}
        style={{ transformStyle: "preserve-3d", animationDelay: playing ? `${riseAtMs}ms` : undefined }}
      >
        <Box h={heightPx} w={w} hollow={hollow} urgent={urgent} />
      </div>
      {/* Lift the label to the column top, then undo the plane's tilt so it faces the camera. */}
      <div
        className="absolute top-1/2 left-1/2"
        style={{ transformOrigin: "0 0", transform: `translateZ(${heightPx + 8}px) rotateZ(${-tilt.z}deg) rotateX(${-tilt.x}deg) translate(-50%, -100%)` }}
      >
        {label}
      </div>
    </div>
  );
}
