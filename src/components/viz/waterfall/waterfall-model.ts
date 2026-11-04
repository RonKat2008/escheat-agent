/**
 * Waterfall geometry for a liability roll-forward: an opening total, floating increase / decrease bars, and a closing
 * total. Pure: values in integer cents, positions as percentages of the tallest running balance, labels formatted.
 */
import { formatUSD } from "@/lib/money";

export type BarDirection = "total" | "up" | "down";

export interface WaterfallStep {
  id: string;
  label: string;
  /** Totals: the balance. Movements: the positive amount; `direction` says which way it moves. */
  cents: number;
  direction: BarDirection;
}

export interface WaterfallBar extends WaterfallStep {
  /** Running balance before and after the bar (totals run from 0). */
  from: number;
  to: number;
  /** Bottom edge and height as % of the scale (0..100). */
  bottomPct: number;
  heightPct: number;
  /** "$42,947.32", "+$18,967.68", "−$773.74" (U+2212 minus); a zero movement reads "$0.00". */
  display: string;
}

export interface WaterfallModel {
  bars: WaterfallBar[];
  /** Scale top in cents (the tallest running balance, at least 1). */
  max: number;
  /** Closing equals opening plus every movement (the bars reconcile). */
  reconciles: boolean;
}

export const MINUS = "−";

export function signedDisplay(direction: BarDirection, cents: number): string {
  if (direction === "total" || cents === 0) return formatUSD(cents);
  return `${direction === "up" ? "+" : MINUS}${formatUSD(Math.abs(cents))}`;
}

export function waterfallModel(steps: readonly WaterfallStep[]): WaterfallModel {
  let running = 0;
  let sumMoves = 0;
  let opening: number | null = null;
  const spans = steps.map((s) => {
    if (s.direction === "total") {
      if (opening === null) opening = s.cents;
      running = s.cents;
      return { s, from: 0, to: s.cents };
    }
    const from = running;
    const to = s.direction === "up" ? from + s.cents : from - s.cents;
    sumMoves += to - from;
    running = to;
    return { s, from, to };
  });
  const max = Math.max(1, ...spans.flatMap((x) => [x.from, x.to]));
  const pct = (c: number) => (Math.max(0, c) / max) * 100;
  const bars = spans.map(({ s, from, to }) => {
    const lo = Math.min(from, to);
    const hi = Math.max(from, to);
    return { ...s, from, to, bottomPct: pct(lo), heightPct: pct(hi) - pct(lo), display: signedDisplay(s.direction, s.cents) };
  });
  const last = [...steps].reverse().find((s) => s.direction === "total");
  const reconciles = opening === null || last === undefined || (opening as number) + sumMoves === last.cents;
  return { bars, max, reconciles };
}
