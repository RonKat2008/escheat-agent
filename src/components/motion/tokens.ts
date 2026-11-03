/**
 * Motion tokens (DESIGN-V3 §2.1). One source: globals.css mirrors these as --dur-* / --ease-* custom properties.
 * Pure data, safe to import from server and client code.
 */

/** Durations in milliseconds. */
export const DUR = {
  instant: 90,
  fast: 150,
  base: 240,
  slow: 400,
  draw: 900,
  num: 700,
  hero: 1400,
} as const;

/** Durations in seconds, for motion's `transition.duration`. */
export const DUR_S = Object.fromEntries(Object.entries(DUR).map(([k, v]) => [k, v / 1000])) as { readonly [K in keyof typeof DUR]: number };

export type Bezier = readonly [number, number, number, number];

/** Cubic-bezier control points (motion `ease` accepts these arrays). */
export const EASE = {
  out: [0.25, 1, 0.5, 1],
  outExpo: [0.16, 1, 0.3, 1],
  inOut: [0.65, 0, 0.35, 1],
  in: [0.5, 0, 0.75, 0],
} as const satisfies Record<string, Bezier>;

/** CSS strings for the same curves. */
export const EASE_CSS = {
  out: "cubic-bezier(0.25, 1, 0.5, 1)",
  outExpo: "cubic-bezier(0.16, 1, 0.3, 1)",
  inOut: "cubic-bezier(0.65, 0, 0.35, 1)",
  in: "cubic-bezier(0.5, 0, 0.75, 0)",
} as const;

/** Springs (§2.1). `stamp` is the only overshoot in the app. */
export const SPRING = {
  snappy: { type: "spring", stiffness: 520, damping: 38, mass: 0.8 },
  sheet: { type: "spring", stiffness: 420, damping: 40, mass: 1 },
  layout: { type: "spring", stiffness: 500, damping: 42 },
  camera: { type: "spring", stiffness: 120, damping: 26, mass: 1.2 },
  stamp: { type: "spring", stiffness: 700, damping: 22 },
} as const;

/** Stagger rules (§2.2 rule 3). */
export const STAGGER = {
  listMs: 30,
  listCap: 8,
  nodeMs: 60,
  nodeCap: 10,
} as const;

/** Delay for the i-th list item: 30ms apart, capped at 8 items (240ms max). */
export function listDelayMs(i: number): number {
  return Math.min(Math.max(0, i), STAGGER.listCap) * STAGGER.listMs;
}

/** Delay for the i-th diagram node: 60ms apart, capped at 10. */
export function nodeDelayMs(i: number): number {
  return Math.min(Math.max(0, i), STAGGER.nodeCap) * STAGGER.nodeMs;
}

/** Exits are faster than entrances (§2.2 rule 4): 0.66 x the enter duration. */
export function exitMs(enterMs: number): number {
  return Math.round(enterMs * 0.66);
}

/**
 * Cause, then path, then effect (§2.2 rule 1). Returns explicit start offsets (ms) for a source pulse, a path draw
 * and the destination tick, chained after `startMs`.
 */
export function causePathEffect(startMs = 0, { pulse = 120, draw = DUR.draw } = {}): { source: number; path: number; effect: number; end: number } {
  const source = startMs;
  const path = source + pulse;
  const effect = path + draw;
  return { source, path, effect, end: effect + DUR.num };
}
