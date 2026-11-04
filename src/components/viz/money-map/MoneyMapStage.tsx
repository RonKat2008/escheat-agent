"use client";

import { m } from "motion/react";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from "react";
import { SPRING, useHeroOnce } from "@/components/motion";
import { Stage3D, useRenderTier, VIZ, type RenderTier } from "@/components/viz/core";
import { cn } from "@/lib/utils";
import { FlowArc } from "./FlowArc";
import { flatArc, layoutColumns, type MapColumn } from "./map-model";
import { StateColumn } from "./StateColumn";
import type { MapHq, MapRecovered, MapStateDatum } from "./types";
import "./money-map.css";

const NARROW_QUERY = "(max-width: 639px)";
/** Choreography (§6.3): the plane settles at 300ms, arcs draw from 500ms staggered 120ms, columns rise as arcs land. */
const SETTLE_AT = 300;
const ARCS_AT = 500;
const ARC_STAGGER = 120;
const ARC_DRAW = 900;
/** Height a state label needs above its column's top (two lines plus the UNVERIFIED chip on wide screens). */
const LABEL_ABOVE_PX = 76;
/** Breathing room kept between the highest rendered label and the top edge of the stage. */
const LABEL_CLEARANCE_PX = 8;

function subscribeNarrow(cb: () => void) {
  const mq = window.matchMedia(NARROW_QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
const useNarrow = () =>
  useSyncExternalStore(
    subscribeNarrow,
    () => window.matchMedia(NARROW_QUERY).matches,
    () => false,
  );

/** Plane width in px (the 3D arcs need real distances); 0 until measured. */
function useWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e?.contentRect.width ?? 0)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

export interface MoneyMapStageProps {
  states: MapStateDatum[];
  hq: MapHq | null;
  recovered: MapRecovered[];
  viewBox: { width: number; height: number };
  /** Server-rendered floor SVG (US outline, borders, highlighted states). */
  floor: ReactNode;
  /** Readout shown when no column is active (legend and honest notes). */
  legend: ReactNode;
}

/**
 * The dashboard hero (DESIGN-V3 §3.2): a tilted US floor with an exposure column standing on each state and blue
 * threads rising from HQ to each column. Tiers: full = tilt + parallax + particles; lite (and phones) = fixed tilt, no
 * particles; static (reduced motion) = a flat 2D map with bars and the same labels. SSR renders the static map.
 */
export function MoneyMapStage({ states, hq, recovered, viewBox, floor, legend }: MoneyMapStageProps) {
  const detected = useRenderTier();
  const narrow = useNarrow();
  const tier: RenderTier = narrow && detected === "full" ? "lite" : detected;
  const flat = tier === "static";
  const tilt = narrow ? { x: 30, z: 0 } : { x: 54, z: -8 };
  const heroFirst = useHeroOnce("dashboard-map");
  const play = heroFirst && !flat;
  const [particlesOn, setParticlesOn] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const planeRef = useRef<HTMLDivElement>(null);
  const width = useWidth(planeRef);
  const height = width * (viewBox.height / viewBox.width);
  const readoutId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [measuredPad, setMeasuredPad] = useState(0);

  const columns: (MapColumn & { datum: MapStateDatum })[] = useMemo(() => {
    const laid = layoutColumns(
      states.map((s) => ({ state: s.state, name: s.name, cents: s.cents, count: s.count, cx: s.cx, cy: s.cy })),
      viewBox,
      narrow ? 90 : 150,
    );
    return laid.map((c, i) => ({ ...c, datum: states[i]! }));
  }, [states, viewBox, narrow]);

  // A tall column near the top of the plane pushes its label above the stage: reserve exactly that room so the label
  // never covers the heading or the cards above it.
  const basePad = narrow ? 40 : 56;
  const modelPad = Math.ceil(columns.reduce((max, c) => Math.max(max, c.heightPx + LABEL_ABOVE_PX - c.top * height), basePad));

  // The model above assumes a label height. Fonts, wrapping and the 3D tilt change it, so also measure where the labels
  // really land and reserve whatever is missing: a tile can then never sit over the heading, whatever the font.
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const plane = planeRef.current;
    if (!wrap || !plane) return;
    const measure = () => {
      const labels = Array.from(wrap.querySelectorAll<HTMLElement>("[data-map-col]"));
      if (labels.length === 0) return;
      const applied = Number.parseFloat(getComputedStyle(wrap).paddingTop) || 0;
      const planeOffset = plane.getBoundingClientRect().top - wrap.getBoundingClientRect().top - applied;
      const highest = Math.min(...labels.map((l) => l.getBoundingClientRect().top));
      const need = Math.ceil(plane.getBoundingClientRect().top - highest - planeOffset + LABEL_CLEARANCE_PX);
      setMeasuredPad((prev) => (Math.abs(prev - need) > 1 ? Math.max(0, need) : prev));
    };
    measure();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    ro?.observe(plane);
    ro?.observe(wrap);
    void document.fonts?.ready.then(measure);
    return () => ro?.disconnect();
  }, [columns, flat, narrow]);
  const padTop = Math.max(modelPad, measuredPad);

  // Particles start once the arcs have landed (or right away when there is no hero to wait for).
  useEffect(() => {
    if (tier !== "full") return;
    const delay = play ? ARCS_AT + columns.length * ARC_STAGGER + ARC_DRAW : 0;
    const id = window.setTimeout(() => setParticlesOn(true), delay);
    return () => window.clearTimeout(id);
  }, [tier, play, columns.length]);

  const hqPt = hq ? { x: (hq.cx / viewBox.width) * width, y: (hq.cy / viewBox.height) * height } : null;
  const arcAt = (i: number) => (play ? ARCS_AT + i * ARC_STAGGER : null);
  const riseAt = (i: number) => (play ? ARCS_AT + i * ARC_STAGGER + ARC_DRAW * 0.8 : null);
  const activeDatum = states.find((s) => s.state === active) ?? null;

  const onArrow = (e: KeyboardEvent<HTMLAnchorElement>) => {
    const keys = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"];
    if (!keys.includes(e.key)) return;
    const links = Array.from(e.currentTarget.closest("[data-map-root]")?.querySelectorAll<HTMLAnchorElement>("[data-map-col]") ?? []);
    const i = links.indexOf(e.currentTarget);
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1;
    const next = links[(i + step + links.length) % links.length];
    if (next) {
      e.preventDefault();
      next.focus();
    }
  };

  return (
    <div data-map-root data-tier={tier} className="relative">
      <div ref={wrapRef} className={cn("relative overflow-x-clip", narrow ? "pb-2" : "pb-6")} style={{ paddingTop: padTop }}>
        <div aria-hidden className="vault-floor pointer-events-none absolute inset-0" />
        <Stage3D tier={tier} rotateX={tilt.x} rotateZ={tilt.z} parallax={!narrow} className="mx-auto w-[94%]">
          <m.div
            key={play ? "play" : "final"}
            style={{ transformStyle: "preserve-3d" }}
            initial={play ? { rotateX: 10, opacity: 0.4 } : false}
            animate={{ rotateX: 0, opacity: 1 }}
            transition={{ ...SPRING.camera, delay: SETTLE_AT / 1000 }}
          >
            <div ref={planeRef} className="relative w-full" style={{ aspectRatio: `${viewBox.width} / ${viewBox.height}`, transformStyle: "preserve-3d" }}>
              {floor}
              {flat ? (
                <svg aria-hidden viewBox={`0 0 ${viewBox.width} ${viewBox.height}`} className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
                  <defs>
                    <marker id="es-map-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                      <path d="M0,0L8,4L0,8Z" fill={VIZ.blue400} />
                    </marker>
                  </defs>
                  {hq
                    ? columns.map((c) =>
                        Math.hypot(c.cx - hq.cx, c.cy - hq.cy) < 12 ? null : (
                          <path
                            key={c.state}
                            d={flatArc({ x: hq.cx, y: hq.cy }, { x: c.cx, y: c.cy })}
                            fill="none"
                            stroke={VIZ.blue500}
                            strokeOpacity={active && active !== c.state ? 0.25 : 0.8}
                            strokeWidth={2}
                            markerEnd="url(#es-map-arrow)"
                          />
                        ),
                      )
                    : null}
                  {hq
                    ? recovered.map((r) => (
                        <path
                          key={`r-${r.state}`}
                          d={flatArc({ x: r.cx, y: r.cy }, { x: hq.cx, y: hq.cy }, 0.12)}
                          fill="none"
                          stroke={VIZ.blue300}
                          strokeWidth={1.5}
                          strokeDasharray="4 4"
                          markerEnd="url(#es-map-arrow)"
                        />
                      ))
                    : null}
                </svg>
              ) : width > 0 && hqPt ? (
                <>
                  {columns.map((c, i) => (
                    <FlowArc
                      key={c.state}
                      from={hqPt}
                      to={{ x: c.left * width, y: c.top * height }}
                      endHeight={c.heightPx}
                      tier={tier}
                      particles={c.particles}
                      drawAtMs={arcAt(i)}
                      particlesOn={particlesOn}
                      highlighted={active === c.state}
                      dimmed={active !== null && active !== c.state}
                    />
                  ))}
                  {recovered.map((r) => (
                    <FlowArc
                      key={`r-${r.state}`}
                      variant="recovered"
                      from={{ x: (r.cx / viewBox.width) * width, y: (r.cy / viewBox.height) * height }}
                      to={hqPt}
                      endHeight={0}
                      tier={tier}
                      particles={Math.min(6, r.count)}
                      drawAtMs={play ? ARCS_AT + columns.length * ARC_STAGGER + ARC_DRAW : null}
                      particlesOn={particlesOn}
                      highlighted={false}
                      dimmed={active !== null}
                    />
                  ))}
                </>
              ) : null}
              {hq ? <HqMarker hq={hq} viewBox={viewBox} /> : null}
              {columns.map((c, i) => (
                <StateColumn
                  key={c.state}
                  d={c.datum}
                  left={c.left}
                  top={c.top}
                  heightPx={c.heightPx}
                  hollow={c.hollow}
                  flat={flat}
                  tilt={tilt}
                  riseAtMs={riseAt(i)}
                  active={active === c.state}
                  dimmed={active !== null && active !== c.state}
                  compact={narrow}
                  describedBy={readoutId}
                  onActivate={setActive}
                  onArrow={onArrow}
                />
              ))}
            </div>
          </m.div>
        </Stage3D>
      </div>
      <div id={readoutId} className="min-h-[88px] border-t border-line px-1 pt-3">
        {activeDatum ? <Readout d={activeDatum} /> : legend}
      </div>
    </div>
  );
}

/** HQ lies flat on the floor: a ring and a mono label, read as a marking on the map. */
function HqMarker({ hq, viewBox }: { hq: MapHq; viewBox: { width: number; height: number } }) {
  return (
    <div aria-hidden className="pointer-events-none absolute" style={{ left: `${(hq.cx / viewBox.width) * 100}%`, top: `${(hq.cy / viewBox.height) * 100}%` }}>
      <span className="absolute block size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-blue-400 bg-blue-950/80" />
      <span className="absolute block size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-300" />
      <span className="absolute top-3 right-0 font-mono text-[10px] font-medium tracking-[0.08em] whitespace-nowrap text-blue-300">HQ · {hq.state}</span>
    </div>
  );
}

/** What the active column holds: the state, its total and its three largest items. */
function Readout({ d }: { d: MapStateDatum }) {
  return (
    <div className="grid gap-x-6 gap-y-1 sm:grid-cols-[auto_minmax(0,1fr)]">
      <div>
        <p className="instrument-label">{d.name}</p>
        <p className="num mt-1 text-lg font-medium tracking-[-0.015em] text-fg-1">{d.formatted}</p>
        <p className="text-xs text-fg-2">
          <span className="num">{d.count}</span> {d.count === 1 ? "item" : "items"}
          {d.late > 0 ? (
            <>
              , <span className="num text-pink-400">{d.late}</span> <span className="text-pink-400">overdue</span>
            </>
          ) : null}
          {d.urgent > 0 ? (
            <>
              , <span className="num text-pink-400">{d.urgent}</span> <span className="text-pink-400">due within 7 days</span>
            </>
          ) : null}
        </p>
      </div>
      <ul className="min-w-0 text-[13px]" aria-label={`Largest items in ${d.name}`}>
        {d.top.map((t) => (
          <li key={t.id} className="flex items-baseline justify-between gap-3 py-0.5">
            <span className="min-w-0 truncate text-fg-1">
              {t.payee}
              {t.check ? <span className="font-mono text-fg-3"> #{t.check}</span> : null}
            </span>
            <span className="num shrink-0 text-fg-2">{t.formatted}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

