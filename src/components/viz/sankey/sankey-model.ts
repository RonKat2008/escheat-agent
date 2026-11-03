/**
 * Pure Sankey layout for the money-flow diagram (DESIGN-V3 §4.2). d3-sankey positions the nodes and link bands; this
 * module copies the inputs (d3 mutates), transposes for the vertical (phone) layout, mirrors the reverse recovery band
 * and builds the cubic link paths. No React, no DOM: unit tested in node.
 */
import { sankey } from "d3-sankey";
import type { FlowLink, FlowNode } from "@/lib/queries/flow";

export type SankeyOrientation = "horizontal" | "vertical";

export interface SankeyBox {
  width: number;
  height: number;
  nodeWidth?: number;
  nodePadding?: number;
  /** Room kept free for labels on the far side of the last column (horizontal) or below the last row (vertical). */
  labelGutter?: number;
}

export interface LaidNode extends FlowNode {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** Where its label goes relative to the bar. */
  labelSide: "right" | "left" | "below";
}

export interface LaidLink extends FlowLink {
  /** Band thickness in px (proportional to cents). */
  width: number;
  /** Centerline path, stroked with `width`. Runs from source to target (particles follow it). */
  d: string;
}

export interface SankeyLayout {
  width: number;
  height: number;
  orientation: SankeyOrientation;
  nodes: LaidNode[];
  links: LaidLink[];
}

interface DNode {
  id: string;
  column: number;
  x0?: number;
  x1?: number;
  y0?: number;
  y1?: number;
}
interface DLink {
  source: string | DNode;
  target: string | DNode;
  value: number;
  width?: number;
  y0?: number;
  y1?: number;
  key: number;
}

/** Horizontal cubic through the band's centerline. */
export function horizontalPath(sx: number, sy: number, tx: number, ty: number): string {
  const mx = (sx + tx) / 2;
  return `M${r(sx)},${r(sy)}C${r(mx)},${r(sy)} ${r(mx)},${r(ty)} ${r(tx)},${r(ty)}`;
}

/** Vertical cubic (the transposed layout). */
export function verticalPath(sx: number, sy: number, tx: number, ty: number): string {
  const my = (sy + ty) / 2;
  return `M${r(sx)},${r(sy)}C${r(sx)},${r(my)} ${r(tx)},${r(my)} ${r(tx)},${r(ty)}`;
}

const r = (n: number) => Math.round(n * 10) / 10;

/**
 * Lay out one band of nodes and links. Link widths are proportional to cents; zero links never reach here
 * (getMoneyFlow drops them). `mirror` flips x so the band reads right to left (the recovery band).
 */
export function layoutSankey(nodes: FlowNode[], links: FlowLink[], box: SankeyBox, orientation: SankeyOrientation = "horizontal", mirror = false): SankeyLayout {
  const { width, height, nodeWidth = 10, nodePadding = 18, labelGutter = 0 } = box;
  if (nodes.length === 0 || links.length === 0) return { width, height, orientation, nodes: [], links: [] };
  // Compute in "flow space": x along the flow, y across it. Vertical swaps the box.
  const along = orientation === "horizontal" ? width : height;
  const across = orientation === "horizontal" ? height : width;
  const maxCol = Math.max(...nodes.map((n) => n.column));
  const gen = sankey<DNode, DLink>()
    .nodeId((d) => d.id)
    .nodeWidth(nodeWidth)
    .nodePadding(nodePadding)
    .nodeAlign((n) => Math.min((n as DNode).column, maxCol))
    .nodeSort(null as never)
    .linkSort(null as never)
    .extent([
      [1, 1],
      [Math.max(nodeWidth + 2, along - 1 - labelGutter), Math.max(2, across - 1)],
    ]);
  const graph = gen({
    nodes: nodes.map((n) => ({ id: n.id, column: n.column })),
    links: links.map((l, key) => ({ source: l.source, target: l.target, value: l.cents, key })),
  });

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const fx = (x: number) => (mirror ? along - x : x);
  const laidNodes: LaidNode[] = graph.nodes.map((g) => {
    const src = byId.get(g.id)!;
    let x0 = fx(g.x0 ?? 0);
    let x1 = fx(g.x1 ?? 0);
    if (x0 > x1) [x0, x1] = [x1, x0];
    const y0 = g.y0 ?? 0;
    const y1 = g.y1 ?? 0;
    // Labels read away from the flow's start: right of each bar (the last column's sit in the gutter), or left in the
    // mirrored recovery band, whose gutter is on the left.
    const labelSide: LaidNode["labelSide"] = orientation === "vertical" ? "below" : mirror ? "left" : "right";
    return orientation === "horizontal" ? { ...src, x0, x1, y0, y1, labelSide } : { ...src, x0: y0, x1: y1, y0: x0, y1: x1, labelSide };
  });

  const laidLinks: LaidLink[] = graph.links.map((g) => {
    const src = links[g.key]!;
    const s = g.source as DNode;
    const t = g.target as DNode;
    const sx = fx(mirror ? (s.x0 ?? 0) : (s.x1 ?? 0));
    const tx = fx(mirror ? (t.x1 ?? 0) : (t.x0 ?? 0));
    const sy = g.y0 ?? 0;
    const ty = g.y1 ?? 0;
    const d = orientation === "horizontal" ? horizontalPath(sx, sy, tx, ty) : verticalPath(sy, sx, ty, tx);
    return { ...src, width: Math.max(1, g.width ?? 1), d };
  });
  return { width, height, orientation, nodes: laidNodes, links: laidLinks };
}

/** Short node names for the narrow vertical layout. */
export function shortLabel(n: Pick<FlowNode, "id" | "label" | "kind" | "state">): string {
  if (n.kind === "state") return n.state === "UNKNOWN" ? "Unknown" : (n.state ?? n.label);
  const SHORT: Record<string, string> = {
    cleared: "Cleared",
    not_stale: "Not stale",
    resolved: "Resolved",
    dd: "In DD",
    to_report: "To report",
    needs_rule: "No rule",
    recovered: "Recovered",
    claims: "Claims",
    portals: "Portals",
  };
  return SHORT[n.id] ?? n.label;
}

/** Particles per link: one per two items, at least one, capped so a diagram never exceeds `total`. */
export function particleBudget(links: Pick<FlowLink, "count">[], perLinkCap = 4, total = 36): number[] {
  const want = links.map((l) => Math.min(perLinkCap, Math.max(1, Math.ceil(l.count / 2))));
  const sumWant = want.reduce((a, n) => a + n, 0);
  if (sumWant <= total) return want;
  const scale = total / sumWant;
  return want.map((n) => Math.max(0, Math.floor(n * scale)));
}
