"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { m } from "motion/react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { SPRING } from "@/components/motion/tokens";
import { SrTable } from "@/components/viz/core/SrTable";
import type { RenderTier } from "@/components/viz/core/render-tier";
import { cn } from "@/lib/utils";
import { clampFocus, layoutTunnel, PERSPECTIVE, RING_GAP, type TunnelRing, type TunnelStageInput } from "./tunnel-model";

export interface LifecycleTunnelProps {
  stages: readonly TunnelStageInput[];
  asOf: string;
  nextKey?: string;
  /** The stage whose derivation is shown next to the tunnel. */
  selectedKey?: string | null;
  onSelect?: (key: string) => void;
  tier: RenderTier;
  className?: string;
}

/** Rings deeper than this only draw their outline; the stage strip below carries their text. */
const LABEL_DEPTH = 1;
const WHEEL_STEP_MS = 280;
const RING = 200;

const fmtDate = (iso: string) =>
  new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));

function ringBorder(r: TunnelRing): string {
  if (r.state === "unknown") return "border border-dashed border-fg-4";
  if (r.state === "past") return "border-2 border-blue-500 bg-blue-950/40";
  if (r.state === "next") return r.urgent ? "border-2 border-pink-500 glow-human" : "border-2 border-blue-400";
  return "border border-line-strong";
}

function stateWord(r: TunnelRing): string {
  if (r.state === "unknown") return "date unknown";
  if (r.state === "past") return "past";
  if (r.state === "next") return r.urgent ? "next deadline, within 7 days" : "next deadline";
  return "upcoming";
}

function Ring({ r, selected, onPick }: { r: TunnelRing; selected: boolean; onPick: () => void }) {
  return (
    <div
      aria-hidden
      data-testid="tunnel-ring"
      data-ring={r.key}
      data-state={r.state}
      data-depth={r.depth}
      className="absolute top-1/2 left-1/2"
      style={{
        width: RING,
        height: RING,
        marginLeft: -RING / 2,
        marginTop: -RING / 2,
        transform: `translateZ(${r.z}px)`,
        visibility: r.visible ? "visible" : "hidden",
      }}
    >
      <button
        type="button"
        tabIndex={-1}
        onClick={onPick}
        className={cn("absolute inset-0 rounded-full transition-[border-color,opacity] duration-150", ringBorder(r), selected && "outline-2 outline-offset-4 outline-blue-300")}
        style={{ opacity: r.opacity }}
      />
      {r.depth <= LABEL_DEPTH ? (
        // The focused ring labels below itself, the next one above, so the two never collide in projection.
        <div className={cn("pointer-events-none absolute left-1/2 w-48 -translate-x-1/2 text-center", r.depth === 0 ? "top-full mt-2" : "bottom-full mb-2")}>
          <p className={cn("text-[13px] font-medium", r.state === "future" || r.state === "unknown" ? "text-fg-2" : "text-fg-1")}>{r.label}</p>
          <p className={cn("num font-mono text-[11px]", r.urgent ? "text-pink-400" : r.date ? "text-fg-2" : "text-fg-3 italic")}>
            {r.date ? fmtDate(r.date) : "Unknown"}
            {r.unverified ? <span className="ml-1.5 rounded-sm border border-line-strong px-1 text-[9.5px] tracking-[0.06em] text-fg-2">UNVERIFIED</span> : null}
          </p>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The item's legal lifecycle as rings receding in depth (DESIGN-V3 §3.3). CSS 3D only, 0 KB. j/k (while the tunnel
 * has focus), the arrow buttons or the wheel move the camera ring to ring on the `camera` spring. The parent renders
 * the flat LifecycleRail instead at the static tier. Every date is the engine's; unknown stays Unknown.
 */
export function LifecycleTunnel({ stages, asOf, nextKey, selectedKey, onSelect, tier, className }: LifecycleTunnelProps) {
  const base = useMemo(() => layoutTunnel({ stages, asOf, nextKey }), [stages, asOf, nextKey]);
  const [focus, setFocus] = useState(base.focus);
  const layout = useMemo(() => layoutTunnel({ stages, asOf, nextKey, focus }), [stages, asOf, nextKey, focus]);
  const stageRef = useRef<HTMLDivElement>(null);
  const lastWheel = useRef(0);
  const count = layout.rings.length;

  const go = (i: number) => setFocus(clampFocus(i, count));
  const pick = (i: number) => {
    go(i);
    const key = layout.rings[i]?.key;
    if (key) onSelect?.(key);
  };

  // Wheel moves the camera one ring per notch. Native listener so it can be non-passive (keeps the drawer still).
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    function onWheel(e: WheelEvent) {
      if (Math.abs(e.deltaY) < 4) return;
      e.preventDefault();
      const now = performance.now();
      if (now - lastWheel.current < WHEEL_STEP_MS) return;
      lastWheel.current = now;
      setFocus((f) => clampFocus(f + (e.deltaY > 0 ? 1 : -1), count));
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [count]);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const dir = e.key === "j" || e.key === "ArrowRight" ? 1 : e.key === "k" || e.key === "ArrowLeft" ? -1 : 0;
    if (dir === 0) return;
    // Keep the list's own j/k (next item) from firing while the tunnel owns the keys.
    e.preventDefault();
    e.stopPropagation();
    pick(clampFocus(focus + dir, count));
  }

  const focused = layout.rings[layout.focus];
  const springy = tier === "full";

  return (
    <div className={cn("space-y-3", className)} data-testid="lifecycle-tunnel" data-focus={layout.focus}>
      <div
        ref={stageRef}
        tabIndex={0}
        role="group"
        aria-roledescription="lifecycle tunnel"
        aria-label={`Lifecycle tunnel. Showing ${focused ? `${focused.label}, ${focused.date ? fmtDate(focused.date) : "date unknown"}` : "nothing"}. Press j or k to move between stages.`}
        aria-keyshortcuts="J K"
        onKeyDown={onKeyDown}
        className="relative h-[300px] overflow-hidden rounded-[14px] border border-line bg-ink-0 outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-1"
        style={{ perspective: `${PERSPECTIVE}px`, perspectiveOrigin: "50% 42%" }}
      >
        <div aria-hidden className="vault-floor pointer-events-none absolute inset-0" />
        <m.div
          className="absolute inset-0"
          style={{ transformStyle: "preserve-3d" }}
          initial={false}
          animate={{ z: layout.cameraZ }}
          transition={springy ? SPRING.camera : { duration: 0.2, ease: [0.25, 1, 0.5, 1] }}
        >
          {layout.todayZ !== null && layout.todayZ <= -layout.focus * RING_GAP + 1 ? (
            <div
              aria-hidden
              data-testid="tunnel-today"
              className="absolute top-1/2 left-1/2 rounded-full border border-dashed border-blue-400 bg-blue-500/10"
              style={{ width: RING - 24, height: RING - 24, marginLeft: -(RING - 24) / 2, marginTop: -(RING - 24) / 2, transform: `translateZ(${layout.todayZ}px)` }}
            >
              <span className="absolute -top-5 left-1/2 -translate-x-1/2 font-mono text-[10px] tracking-[0.08em] text-blue-300">TODAY</span>
            </div>
          ) : null}
          {layout.rings
            .slice()
            .reverse()
            .map((r) => (
              <Ring key={r.key} r={r} selected={r.key === selectedKey} onPick={() => pick(r.index)} />
            ))}
        </m.div>
        <div className="absolute top-3 left-3 instrument-label">
          Stage {layout.focus + 1} of {count}
        </div>
        <div className="absolute right-2 bottom-2 flex gap-1">
          <button
            type="button"
            aria-label="Previous stage"
            disabled={layout.focus === 0}
            onClick={() => pick(layout.focus - 1)}
            className="grid size-8 place-items-center rounded-md border border-line bg-ink-1 text-fg-2 transition-colors duration-150 hover:text-fg-1 disabled:opacity-40"
          >
            <ChevronLeft className="size-4" strokeWidth={1.5} aria-hidden />
          </button>
          <button
            type="button"
            aria-label="Next stage"
            disabled={layout.focus >= count - 1}
            onClick={() => pick(layout.focus + 1)}
            className="grid size-8 place-items-center rounded-md border border-line bg-ink-1 text-fg-2 transition-colors duration-150 hover:text-fg-1 disabled:opacity-40"
          >
            <ChevronRight className="size-4" strokeWidth={1.5} aria-hidden />
          </button>
        </div>
      </div>

      <ol className="flex flex-wrap gap-1.5" aria-label="Lifecycle stages">
        {layout.rings.map((r) => (
          <li key={r.key}>
            <button
              type="button"
              data-testid="tunnel-stage"
              data-stage={r.key}
              aria-current={r.index === layout.focus ? "step" : undefined}
              aria-label={`${r.label}, ${r.date ? fmtDate(r.date) : "date unknown"}, ${stateWord(r)}${r.unverified ? ", unverified" : ""}`}
              onClick={() => pick(r.index)}
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs transition-colors duration-150",
                r.index === layout.focus ? "border-line-strong bg-ink-3 text-fg-1" : "border-line text-fg-2 hover:border-line-hover hover:text-fg-1",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "size-2 rounded-full",
                  r.state === "past" && "bg-blue-500",
                  r.state === "next" && (r.urgent ? "ring-2 ring-pink-500" : "ring-2 ring-blue-400"),
                  r.state === "future" && "ring-1 ring-fg-3",
                  r.state === "unknown" && "border border-dashed border-fg-3",
                )}
              />
              {r.label}
            </button>
          </li>
        ))}
      </ol>

      <SrTable
        caption={`Lifecycle, as of ${asOf}`}
        columns={["Stage", "Date", "Status", "Verification"]}
        rows={layout.rings.map((r) => [r.label, r.date ?? "Unknown", stateWord(r), r.unverified ? "Unverified" : "Verified"])}
      />
    </div>
  );
}
