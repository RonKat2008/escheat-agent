/**
 * Pure geometry for the Pre-stale Horizon radar (no React). Unit square coordinates: the center (0,0) is "issued",
 * radius 1 is the plane's edge. The day->radius scale is piecewise (sqrt inside the stale line, linear beyond) so the
 * 0-180 day band (where AP can still act) gets half the plane, and the multi-year dormancy rings share the outer half.
 */
import type { RenderTier } from "@/components/viz/core";

export const R_ISSUED = 0.06;
export const R_STALE = 0.52;
export const R_MAX = 0.92;
/** Dots never sit exactly on the rim, so they and their glow stay on the plane. */
export const R_DOT_MAX = 0.95;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

export interface RadarScale {
  thresholdDays: number;
  /** The outermost day the plane shows (the furthest dormancy ring). */
  maxDays: number;
}

export function makeScale(thresholdDays: number, ringDays: readonly number[]): RadarScale {
  const t = Math.max(1, thresholdDays);
  const furthest = Math.max(t * 2, ...ringDays);
  return { thresholdDays: t, maxDays: furthest };
}

/** Monotonic non-decreasing; clamped to [R_ISSUED, R_DOT_MAX]. */
export function radiusForDays(days: number, s: RadarScale): number {
  const d = Math.max(0, days);
  let r: number;
  // sqrt inside the actionable band spreads the many young payments instead of piling them on the center.
  if (d <= s.thresholdDays) r = R_ISSUED + Math.sqrt(d / s.thresholdDays) * (R_STALE - R_ISSUED);
  else r = R_STALE + ((d - s.thresholdDays) / Math.max(1, s.maxDays - s.thresholdDays)) * (R_MAX - R_STALE);
  return Math.min(R_DOT_MAX, Math.max(R_ISSUED, r));
}

export type RingKind = "issued" | "mid" | "stale" | "dormancy";

export interface RadarRing {
  key: string;
  kind: RingKind;
  days: number;
  r: number;
  label: string;
  /** Short qualifier shown under the label (business policy / state list). */
  note: string;
  unverified: boolean;
}

export interface RingInput {
  days: number;
  label: string;
  unverified: boolean;
}

export function buildRings(s: RadarScale, dormancy: readonly RingInput[]): RadarRing[] {
  const mid = Math.round(s.thresholdDays / 2);
  const base: RadarRing[] = [
    { key: "issued", kind: "issued", days: 0, r: radiusForDays(0, s), label: "Issued", note: "day 0", unverified: false },
    { key: "mid", kind: "mid", days: mid, r: radiusForDays(mid, s), label: `${mid} days`, note: "outstanding", unverified: false },
    {
      key: "stale",
      kind: "stale",
      days: s.thresholdDays,
      r: radiusForDays(s.thresholdDays, s),
      label: `${s.thresholdDays}-day stale threshold`,
      note: "business policy, not law",
      unverified: false,
    },
  ];
  const outer = [...dormancy]
    .filter((d) => d.days > s.thresholdDays)
    .sort((a, b) => a.days - b.days)
    .map((d): RadarRing => ({ key: `dormancy-${d.days}`, kind: "dormancy", days: d.days, r: radiusForDays(d.days, s), label: d.label, note: "presumed abandoned", unverified: d.unverified }));
  return [...base, ...outer];
}

export interface DotInput {
  id: string;
  ageDays: number;
  amountCents: number;
}

export interface RadarDot {
  id: string;
  x: number;
  y: number;
  r: number;
  /** Dot diameter in px. */
  size: number;
}

export const DOT_MIN_PX = 10;
export const DOT_MAX_PX = 30;

/** Area-proportional size (sqrt), from DOT_MIN_PX to DOT_MAX_PX. */
export function dotSize(amountCents: number, maxCents: number): number {
  if (maxCents <= 0) return DOT_MIN_PX;
  const t = Math.sqrt(Math.max(0, amountCents) / maxCents);
  return Math.round(DOT_MIN_PX + Math.min(1, t) * (DOT_MAX_PX - DOT_MIN_PX));
}

/**
 * Dot positions at a projected age (ageDays + offsetDays). Angles follow the golden angle by index, so the layout is
 * stable while the scrubber moves dots outward along their own spoke.
 */
export function layoutDots(items: readonly DotInput[], s: RadarScale, offsetDays = 0): RadarDot[] {
  const maxCents = Math.max(0, ...items.map((i) => i.amountCents));
  return items.map((it, idx) => {
    const r = radiusForDays(it.ageDays + Math.max(0, offsetDays), s);
    const a = idx * GOLDEN_ANGLE - Math.PI / 2;
    return { id: it.id, x: clampUnit(Math.cos(a) * r), y: clampUnit(Math.sin(a) * r), r, size: dotSize(it.amountCents, maxCents) };
  });
}

/**
 * Rounded to 4 decimals: Math.sin/cos may differ in the last bit between the server (Node) and the browser, and an
 * unrounded value in a style attribute is a hydration mismatch.
 */
export const round4 = (v: number): number => Math.round(v * 1e4) / 1e4;

const clampUnit = (v: number) => round4(Math.min(R_DOT_MAX, Math.max(-R_DOT_MAX, v)));

export interface RadarMotion {
  tilt: boolean;
  sweep: boolean;
  /** Dots glide between scrubber positions. */
  transitions: boolean;
}

/** Reduced motion (tier static) is fully static: flat, no sweep, no transitions. */
export function motionFor(tier: RenderTier): RadarMotion {
  if (tier === "static") return { tilt: false, sweep: false, transitions: false };
  if (tier === "lite") return { tilt: true, sweep: false, transitions: true };
  return { tilt: true, sweep: true, transitions: true };
}
