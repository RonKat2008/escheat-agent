/**
 * Pure geometry for the Money Map (DESIGN-V3 §3.2): column heights from exposure cents, arcs from HQ to each column
 * (in the vertical plane that stands on the floor, and flat for the 2D fallback), and particle counts. No DOM.
 */

export const COLUMN_MAX_PX = 150;
export const COLUMN_MIN_PX = 6;
export const MAX_PARTICLES_PER_ARC = 12;
export const MAX_PARTICLES_TOTAL = 36;

export interface MapPoint {
  x: number;
  y: number;
}

export interface MapColumnInput {
  state: string;
  name: string;
  cents: number;
  count: number;
  /** Projected centroid in floor viewBox units. */
  cx: number;
  cy: number;
}

export interface MapColumn extends MapColumnInput {
  /** Column height in px. 0 means no exposure: drawn as a hollow dashed outline. */
  heightPx: number;
  hollow: boolean;
  /** Position as a share of the floor (0..1), so it scales with the plane. */
  left: number;
  top: number;
  particles: number;
}

/** Proportional to cents, at least 6px when anything is owed, 0 (hollow) when nothing is. */
export function columnHeight(cents: number, count: number, maxCents: number, maxPx = COLUMN_MAX_PX): number {
  if (count <= 0 || cents <= 0) return 0;
  if (maxCents <= 0) return COLUMN_MIN_PX;
  return Math.max(COLUMN_MIN_PX, Math.round((cents / maxCents) * maxPx));
}

/** Particles per arc scale with the state's item count; capped at 12 per arc and 36 overall. */
export function particleCounts(counts: number[]): number[] {
  const want = counts.map((c) => Math.max(0, Math.min(MAX_PARTICLES_PER_ARC, Math.floor(c))));
  const total = want.reduce((a, n) => a + n, 0);
  if (total <= MAX_PARTICLES_TOTAL) return want;
  return want.map((n) => Math.floor((n * MAX_PARTICLES_TOTAL) / total));
}

export function layoutColumns(states: MapColumnInput[], viewBox: { width: number; height: number }, maxPx = COLUMN_MAX_PX): MapColumn[] {
  const max = Math.max(0, ...states.map((s) => s.cents));
  const particles = particleCounts(states.map((s) => s.count));
  return states.map((s, i) => {
    const heightPx = columnHeight(s.cents, s.count, max, maxPx);
    return { ...s, heightPx, hollow: heightPx === 0, left: s.cx / viewBox.width, top: s.cy / viewBox.height, particles: particles[i] ?? 0 };
  });
}

export interface ArcPlane {
  /** Ground distance HQ → column, in px. */
  length: number;
  /** Heading on the floor, degrees (0 = +x, clockwise because screen y points down). */
  angleDeg: number;
  /** Height of the vertical plane the arc is drawn in. */
  planeHeight: number;
  /** Arc in the plane's own coordinates: starts on the floor at (0, planeHeight), lands on the column top. */
  d: string;
}

/**
 * An arc that rises out of the floor from HQ and lands on top of a column of `endHeight` px. The plane it is drawn in
 * stands on the floor (rotateZ(angle) rotateX(-90deg)), so SVG "up" becomes the floor's z axis.
 */
export function arcPlane(from: MapPoint, to: MapPoint, endHeight: number, peakScale = 1): ArcPlane {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
  const peak = Math.max(endHeight + 24, Math.min(220, length * 0.42) * peakScale);
  const planeHeight = Math.ceil(peak + 8);
  const base = planeHeight;
  const r = (n: number) => Math.round(n * 10) / 10;
  // Cubic from the floor, over the peak, landing on the column top.
  const d = `M0,${r(base)}C${r(length * 0.25)},${r(base - peak * 1.25)} ${r(length * 0.75)},${r(base - peak * 1.25)} ${r(length)},${r(base - endHeight)}`;
  return { length, angleDeg, planeHeight, d };
}

/** The 2D fallback arc on the flat map (viewBox units): a quadratic bowed to the left of the direction of travel. */
export function flatArc(from: MapPoint, to: MapPoint, bow = 0.22): string {
  const mx = (from.x + to.x) / 2;
  const my = (from.y + to.y) / 2;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const cx = mx + dy * bow;
  const cy = my - dx * bow;
  const r = (n: number) => Math.round(n * 10) / 10;
  return `M${r(from.x)},${r(from.y)}Q${r(cx)},${r(cy)} ${r(to.x)},${r(to.y)}`;
}

/** "California: $28,410.00 across 21 items, 1 overdue, 2 due within 7 days" (the column's accessible name). */
export function columnName(c: { name: string; formatted: string; count: number; urgent: number; late: number; unverified: boolean }): string {
  const items = `${c.count} ${c.count === 1 ? "item" : "items"}`;
  const late = c.late > 0 ? `, ${c.late} overdue` : "";
  const due = c.urgent > 0 ? `, ${c.urgent} due within 7 days` : "";
  const unv = c.unverified ? ", some dates unverified" : "";
  return `${c.name}: ${c.formatted} across ${items}${late}${due}${unv}`;
}

/**
 * Horizontal anchor of a column's label, as the share of the label's width that sits left of the column (0.5 =
 * centred). Near the plane's edges the label leans inward so it never runs past the map and gets clipped (R4-07: CA at
 * 375). `left` is the column's 0..1 position on the floor; `edge` is how close to an edge leaning starts.
 */
export function labelAnchor(left: number, edge = 0.22): number {
  if (left < edge) return Math.max(0.08, 0.5 * (left / edge));
  if (left > 1 - edge) return Math.min(0.92, 1 - 0.5 * ((1 - left) / edge));
  return 0.5;
}
