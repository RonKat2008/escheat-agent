/**
 * Pure layout for the money-flow diagram (DESIGN-V3 §4.2, rebuilt for dogfood R4-07). Nodes are cards stacked per
 * column; bands run between card edges with a thickness proportional to cents. The vertical geometry (card heights,
 * band widths, total height) depends only on the data, never on the width, so the server can reserve the exact height
 * (no layout shift) and a resize never changes the scale. Labels live inside the cards, which never overlap by
 * construction, so no label can sit on a band or on another label. No React, no DOM: unit tested in node.
 */
import type { FlowLink, FlowNode } from "@/lib/queries/flow";

export interface FlowLayoutOpts {
  /** Px given to the column with the most money (the scale). */
  scalePx?: number;
  /** Smallest card height, so every card can hold its two-line label. */
  minCard?: number;
  /** Smallest height for a three-line card: the Late card (interest) or one carrying an UNVERIFIED badge. */
  minLateCard?: number;
  /** Vertical gap between cards in a column. */
  gap?: number;
  padY?: number;
  /** Thinnest band drawn, so a small amount stays visible and hoverable. */
  minBand?: number;
}

export interface CardBox {
  id: string;
  column: number;
  y: number;
  h: number;
}

export interface LaidCard extends FlowNode {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LaidBand extends FlowLink {
  /** Thickness in px. */
  width: number;
  /** Centerline, stroked with `width`; runs source → target. */
  d: string;
  sx: number;
  sy: number;
  tx: number;
  ty: number;
}

export interface FlowLayout {
  width: number;
  height: number;
  cards: LaidCard[];
  bands: LaidBand[];
}

const DEFAULTS: Required<FlowLayoutOpts> = { scalePx: 240, minCard: 44, minLateCard: 60, gap: 12, padY: 6, minBand: 2 };

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Horizontal cubic through the band's centerline. */
export function horizontalPath(sx: number, sy: number, tx: number, ty: number): string {
  const mx = (sx + tx) / 2;
  return `M${r1(sx)},${r1(sy)}C${r1(mx)},${r1(sy)} ${r1(mx)},${r1(ty)} ${r1(tx)},${r1(ty)}`;
}

/** Px per cent: the fullest column gets `scalePx`. */
export function flowScale(nodes: readonly Pick<FlowNode, "column" | "cents">[], scalePx = DEFAULTS.scalePx): number {
  const byCol = new Map<number, number>();
  for (const n of nodes) byCol.set(n.column, (byCol.get(n.column) ?? 0) + Math.max(0, n.cents));
  const max = Math.max(0, ...byCol.values());
  return max > 0 ? scalePx / max : 0;
}

/**
 * Width-independent vertical layout: each card's y and height, and the total height. Columns are centred on the
 * tallest one; cards keep the order they arrive in (buildMoneyFlow sorts them).
 */
export function stackCards(nodes: readonly FlowNode[], opts: FlowLayoutOpts = {}): { k: number; height: number; boxes: Map<string, CardBox> } {
  const o = { ...DEFAULTS, ...opts };
  const k = flowScale(nodes, o.scalePx);
  const cols = [...new Set(nodes.map((n) => n.column))].sort((a, b) => a - b);
  const heights = new Map(nodes.map((n) => [n.id, Math.max(n.kind === "late" || n.unverified > 0 ? o.minLateCard : o.minCard, Math.round(n.cents * k))]));
  const colH = (c: number) => {
    const ns = nodes.filter((n) => n.column === c);
    return ns.reduce((a, n) => a + heights.get(n.id)!, 0) + o.gap * Math.max(0, ns.length - 1);
  };
  const inner = Math.max(0, ...cols.map(colH));
  const boxes = new Map<string, CardBox>();
  for (const c of cols) {
    let y = o.padY + (inner - colH(c)) / 2;
    for (const n of nodes.filter((x) => x.column === c)) {
      const h = heights.get(n.id)!;
      boxes.set(n.id, { id: n.id, column: c, y: r1(y), h });
      y += h + o.gap;
    }
  }
  return { k, height: Math.ceil(inner + o.padY * 2), boxes };
}

/** Card width for a container width: wide enough for "In due diligence $28,410", narrow enough to leave room for bands. */
export function cardWidth(width: number, columns: number): number {
  if (columns <= 1) return Math.max(0, width);
  return Math.round(Math.min(184, Math.max(118, width * 0.17)));
}

/** Full layout for a measured width. Bands leave and enter each card centred, ordered so they never cross at an edge. */
export function layoutFlow(nodes: readonly FlowNode[], links: readonly FlowLink[], width: number, opts: FlowLayoutOpts = {}): FlowLayout {
  const o = { ...DEFAULTS, ...opts };
  const { k, height, boxes } = stackCards(nodes, o);
  if (nodes.length === 0 || width <= 0) return { width, height, cards: [], bands: [] };
  const maxCol = Math.max(0, ...nodes.map((n) => n.column));
  const w = cardWidth(width, maxCol + 1);
  const xOf = (c: number) => (maxCol === 0 ? 0 : r1((c * (width - w)) / maxCol));
  const cards: LaidCard[] = nodes.map((n) => {
    const b = boxes.get(n.id)!;
    return { ...n, x: xOf(n.column), y: b.y, w, h: b.h };
  });
  const card = new Map(cards.map((c) => [c.id, c]));
  const bandW = (l: FlowLink) => Math.max(o.minBand, l.cents * k);
  const live = links.filter((l) => card.has(l.source) && card.has(l.target));

  // Stack offsets: at the source, outgoing bands ordered by target y; at the target, incoming ordered by source y.
  const offsets = (side: "source" | "target") => {
    const out = new Map<FlowLink, number>();
    const other = side === "source" ? "target" : "source";
    for (const c of cards) {
      const mine = live.filter((l) => l[side] === c.id).sort((a, b) => card.get(a[other])!.y - card.get(b[other])!.y);
      const total = mine.reduce((a, l) => a + bandW(l), 0);
      let y = c.y + (c.h - total) / 2;
      for (const l of mine) {
        out.set(l, y + bandW(l) / 2);
        y += bandW(l);
      }
    }
    return out;
  };
  const sOff = offsets("source");
  const tOff = offsets("target");
  const bands: LaidBand[] = live.map((l) => {
    const s = card.get(l.source)!;
    const t = card.get(l.target)!;
    const sx = s.x + s.w;
    const tx = t.x;
    const sy = r1(sOff.get(l)!);
    const ty = r1(tOff.get(l)!);
    return { ...l, width: r1(bandW(l)), d: horizontalPath(sx, sy, tx, ty), sx, sy, tx, ty };
  });
  return { width, height, cards, bands };
}

export interface Segment {
  link: FlowLink;
  /** Share of the row, 0..100, at least `minPct` so a small amount stays visible (the rest shrink to fit). */
  pct: number;
}

/** Phone layout: one stacked bar per source node, its outgoing bands as segments. */
export function rowSegments(links: readonly FlowLink[], source: string, minPct = 3): Segment[] {
  const out = links.filter((l) => l.source === source && l.cents > 0);
  const total = out.reduce((a, l) => a + l.cents, 0);
  if (total <= 0) return [];
  const raw = out.map((l) => (l.cents / total) * 100);
  const small = raw.filter((p) => p < minPct).length;
  const bigTotal = raw.filter((p) => p >= minPct).reduce((a, p) => a + p, 0);
  const room = 100 - small * minPct;
  return out.map((link, i) => ({ link, pct: raw[i]! < minPct ? minPct : bigTotal > 0 ? (raw[i]! / bigTotal) * room : raw[i]! }));
}

/** A signature of the figures, so a change in data (not a resize) triggers the morph. */
export function flowSignature(nodes: readonly Pick<FlowNode, "id" | "cents" | "count">[]): string {
  return nodes.map((n) => `${n.id}:${n.cents}:${n.count}`).join("|");
}

/** Particles per link: one per two items, at least one, capped so a diagram never exceeds `total`. */
export function particleBudget(links: Pick<FlowLink, "count">[], perLinkCap = 4, total = 36): number[] {
  const want = links.map((l) => Math.min(perLinkCap, Math.max(1, Math.ceil(l.count / 2))));
  const sumWant = want.reduce((a, n) => a + n, 0);
  if (sumWant <= total) return want;
  const scale = total / sumWant;
  return want.map((n) => Math.max(0, Math.floor(n * scale)));
}
