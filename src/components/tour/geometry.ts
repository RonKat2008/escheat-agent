/**
 * Pure geometry for the spotlight and the anchored popover. The spotlight is drawn only with clip-path polygons (the
 * dimmed backdrop with a hole, and a thin ring around the hole), so moving between stops animates clip-path, never
 * layout properties.
 */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Size {
  w: number;
  h: number;
}

export type Side = "bottom" | "top" | "right" | "left" | "center";

export interface Placement {
  x: number;
  y: number;
  side: Side;
}

/** Grow a rect by `pad` and clip it to the viewport (minus `inset`), so a huge target still leaves a visible ring. */
export function spotRect(target: Rect, vp: Size, pad = 8, inset = 4, top = inset): Rect {
  const x1 = Math.max(inset, target.x - pad);
  const y1 = Math.max(top, target.y - pad);
  const x2 = Math.min(vp.w - inset, target.x + target.w + pad);
  const y2 = Math.min(vp.h - inset, target.y + target.h + pad);
  return { x: x1, y: y1, w: Math.max(0, x2 - x1), h: Math.max(0, y2 - y1) };
}

const px = (n: number) => `${Math.round(n * 10) / 10}px`;

/**
 * clip-path polygon of `outer` with `inner` cut out (the "slit" trick: one ring of 10 points, same shape every time,
 * so the browser can interpolate between stops). With no inner rect the hole collapses to a point.
 */
export function holePolygon(outer: Rect, inner: Rect | null): string {
  const i = inner ?? { x: outer.x + outer.w / 2, y: outer.y + outer.h / 2, w: 0, h: 0 };
  const ox1 = outer.x;
  const oy1 = outer.y;
  const ox2 = outer.x + outer.w;
  const oy2 = outer.y + outer.h;
  const ix1 = i.x;
  const iy1 = i.y;
  const ix2 = i.x + i.w;
  const iy2 = i.y + i.h;
  const pts: [number, number][] = [
    [ox1, oy1],
    [ox1, oy2],
    [ix1, oy2],
    [ix1, iy1],
    [ix2, iy1],
    [ix2, iy2],
    [ix1, iy2],
    [ix1, oy2],
    [ox2, oy2],
    [ox2, oy1],
  ];
  return `polygon(${pts.map(([x, y]) => `${px(x)} ${px(y)}`).join(", ")})`;
}

/** The ring around the hole: `hole` grown by `width`, with `hole` cut out. */
export function ringPolygon(hole: Rect | null, width = 2): string {
  if (!hole) return holePolygon({ x: 0, y: 0, w: 0, h: 0 }, null);
  const outer = { x: hole.x - width, y: hole.y - width, w: hole.w + width * 2, h: hole.h + width * 2 };
  return holePolygon(outer, hole);
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Where the popover goes next to the spotlight: below, above, right, then left, the first side where it fits whole;
 * otherwise centered at the bottom of the viewport (over the dimmed area). Always clamped inside the viewport margin.
 */
export function placePopover(target: Rect | null, pop: Size, vp: Size, gap = 12, margin = 16): Placement {
  const maxX = Math.max(margin, vp.w - pop.w - margin);
  const maxY = Math.max(margin, vp.h - pop.h - margin);
  const fallback: Placement = { x: clamp((vp.w - pop.w) / 2, margin, maxX), y: maxY, side: "center" };
  if (!target) return fallback;
  const cx = target.x + target.w / 2 - pop.w / 2;
  const cy = target.y + target.h / 2 - pop.h / 2;
  const fitsX = (x: number) => x >= margin && x + pop.w <= vp.w - margin;
  const fitsY = (y: number) => y >= margin && y + pop.h <= vp.h - margin;
  const below = target.y + target.h + gap;
  if (fitsY(below)) return { x: clamp(cx, margin, maxX), y: below, side: "bottom" };
  const above = target.y - gap - pop.h;
  if (fitsY(above)) return { x: clamp(cx, margin, maxX), y: above, side: "top" };
  const right = target.x + target.w + gap;
  if (fitsX(right)) return { x: right, y: clamp(cy, margin, maxY), side: "right" };
  const left = target.x - gap - pop.w;
  if (fitsX(left)) return { x: left, y: clamp(cy, margin, maxY), side: "left" };
  return fallback;
}
