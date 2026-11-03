/** Pure helpers behind the forecast chart. No React, so they are unit-tested directly. */
import { VIZ } from "@/components/viz/core/palette";

export interface ChartMonth {
  /** YYYY-MM */
  month: string;
  label: string;
  /** Integer cents per state. */
  cents: Record<string, number>;
  /** Items per state behind those cents. */
  counts: Record<string, number>;
  unverified: boolean;
}

/** Fixed per state so a filter never recolors a series (DESIGN-V3 §1.2 chart series: blue-500 / blue-300 / fg-3). */
const STATE_FILL: Record<string, string> = {
  CA: VIZ.series1,
  TX: VIZ.series2,
  DE: VIZ.series3,
};
export const fillFor = (state: string): string => STATE_FILL[state] ?? VIZ.fg4;

/** Axis ticks only: whole dollars, compact ("$12k"). Exact amounts live in the tooltip and the table. */
export function tick(cents: number): string {
  const dollars = Math.round(cents / 100);
  if (dollars >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1)}M`;
  if (dollars >= 10_000) return `$${Math.round(dollars / 1_000)}k`;
  if (dollars >= 1_000) return `$${(dollars / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return `$${dollars}`;
}

export const monthTotal = (m: Pick<ChartMonth, "cents">, states: readonly string[]): number => states.reduce((a, s) => a + (m.cents[s] ?? 0), 0);

/** The highest non-empty segment of a stacked month (gets the rounded top), or null for an empty month. */
export function topStateOf(m: Pick<ChartMonth, "cents">, states: readonly string[]): string | null {
  for (let i = states.length - 1; i >= 0; i--) if ((m.cents[states[i]!] ?? 0) > 0) return states[i]!;
  return null;
}

/**
 * SVG path for one bar segment, top corners rounded by `r` when `roundTop`. Radius is clamped to half the width and
 * the full height, so a sliver never draws a negative arc. Zero or negative sizes give an empty path.
 */
export function barPath(x: number, y: number, w: number, h: number, r: number, roundTop: boolean): string {
  if (!(w > 0) || !(h > 0)) return "";
  const rr = roundTop ? Math.max(0, Math.min(r, w / 2, h)) : 0;
  const n = (v: number) => Math.round(v * 100) / 100;
  if (rr === 0) return `M${n(x)},${n(y)}h${n(w)}v${n(h)}h${n(-w)}Z`;
  return `M${n(x)},${n(y + h)}V${n(y + rr)}Q${n(x)},${n(y)} ${n(x + rr)},${n(y)}H${n(x + w - rr)}Q${n(x + w)},${n(y)} ${n(x + w)},${n(y + rr)}V${n(y + h)}Z`;
}

/** Share of a total as a whole percent string, "<1%" for tiny non-zero shares. */
export function shareLabel(part: number, total: number): string {
  if (total <= 0 || part <= 0) return "0%";
  const p = (part / total) * 100;
  return p < 1 ? "<1%" : `${Math.round(p)}%`;
}
