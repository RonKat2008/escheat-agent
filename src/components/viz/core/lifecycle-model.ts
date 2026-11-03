import { formatLifecycleDate, textWidth, wrapText } from "./lifecycle-text";
import { dayNumber, daysBetween, scaleTime } from "./scales";

export { formatLifecycleDate } from "./lifecycle-text";

export interface LifecycleEventInput {
  key: string;
  label: string;
  date: string | null;
  status: "ok" | "unknown" | "not_applicable";
  verified: boolean;
  ruleVersion?: string | null;
  rulePaths?: string[];
}

export interface LifecycleInput {
  issueDate: string;
  staleSince?: string | null;
  asOf: string;
  events: LifecycleEventInput[];
}

export type NodeState = "past" | "next" | "future" | "unknown";

export interface LifecycleNode {
  key: string;
  label: string;
  /** null only for unknown / not-applicable nodes (never estimated). */
  date: string | null;
  x: number;
  /** Label row on its side of the rail (0 = nearest the rail); -1 when the horizontal layout does not fit. */
  row: number;
  state: NodeState;
  /** Next node within URGENT_DAYS of asOf. */
  urgent: boolean;
  unverified: boolean;
  /** Why the node is in the Unknown lane. */
  reason: "unknown" | "not_applicable" | null;
  ruleVersion: string | null;
  rulePath: string | null;
}

export interface LifecycleTick {
  date: string;
  x: number;
}

export interface LcBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export type LcSide = "above" | "below";
export type LcAlign = "start" | "middle" | "end";
export type LcLabelKind = "node" | "today" | "tick" | "lane";

export interface LcTextLine {
  text: string;
  /** Baseline y. */
  y: number;
  role: "label" | "date" | "caption";
  /** Stage key of a date line (a shared label has one per stage). */
  key?: string;
}

/** One placed label of the horizontal rail, in SVG px of a viewBox exactly `width` wide. */
export interface LcLabel {
  key: string;
  /** Stage keys this label describes: stages closer than CLUSTER_PX on the rail share one label, stacked in date order. */
  keys: string[];
  /** Carries the TODAY caption (its own label, or the first line of a stage label dated today). */
  today: boolean;
  kind: LcLabelKind;
  side: LcSide;
  row: number;
  align: LcAlign;
  /** x of the text anchor (box left, centre or right per `align`). */
  textX: number;
  box: LcBox;
  lines: LcTextLine[];
  /** Top-left of each UNVERIFIED badge (one per date that rests on an unverified rule value). */
  badges: Array<{ x: number; y: number }>;
  /** Hairline from the node marker to the label (node labels only). */
  leader: { x: number; y0: number; y1: number } | null;
}

export interface LcHorizontal {
  /** false when some label could not be placed without overlap; the component then uses the vertical layout. */
  fits: boolean;
  height: number;
  axisY: number;
  labels: LcLabel[];
  /** Dashed Unknown lane rectangle, or null when every date is known. */
  laneRect: LcBox | null;
}

export type LcSegment = "past" | "future";

export type LcVerticalItem =
  | { kind: "node"; node: LifecycleNode; lines: string[]; segBefore: LcSegment | null; segAfter: LcSegment | null; box: LcBox }
  | { kind: "today"; date: string; segBefore: LcSegment | null; segAfter: LcSegment | null; box: LcBox };

export interface LcVertical {
  /** Dated stages and the TODAY row, in date order (TODAY sits where asOf falls). */
  items: LcVerticalItem[];
  /** Unknown / not-applicable stages, listed after the dated ones (never given a date). */
  unknown: LcVerticalItem[];
  height: number;
}

export interface LifecycleLayout {
  width: number;
  orientation: "horizontal" | "vertical";
  trackStart: number;
  trackEnd: number;
  nodes: LifecycleNode[];
  todayX: number;
  /** Progress segment runs from the first node to this x. */
  progressEnd: number;
  ticks: LifecycleTick[];
  /** x-range of the Unknown lane, or null when nothing is unknown. */
  unknownLane: { x0: number; x1: number } | null;
  horizontal: LcHorizontal;
  vertical: LcVertical;
}

export interface LifecycleOptions {
  /** Try to place date tick labels above the rail (dropped wherever they would collide). */
  ticks?: boolean;
}

export const URGENT_DAYS = 7;
/** Below this container width the rail is a vertical list. */
export const VERTICAL_BELOW = 480;
/** Label rows per side of the rail (rows alternate below, above, below, ...). */
export const MAX_ROW = 3;

/** Typography shared with the component (px). */
export const LC_TYPE = {
  labelSize: 12,
  labelLine: 15,
  dateSize: 11,
  dateLine: 15,
  captionSize: 10,
  captionTracking: 0.08,
  badgeW: 74,
  badgeH: 14,
  badgeGap: 4,
} as const;

const PAD = 24;
const EDGE = 2;
const UNKNOWN_SLOT = 104;
const H_GAP = 12;
const ROW_GAP = 10;
const RAIL_GAP = 20;
const LEADER_CLEAR = 4;
const TOP_PAD = 4;
const BOTTOM_PAD = 4;
const CAPTION_H = 12;
/** Stages closer than this on the rail share one label (their markers would overlap anyway). */
const CLUSTER_PX = 14;
const PART_GAP = 6;
/** Vertical list geometry, mirrored by the component's CSS. */
export const LC_VERTICAL = { railCol: 28, rowPadY: 10, labelLine: 18, dateLine: 16, badgeLine: 20, todayH: 28 } as const;

interface Known {
  key: string;
  label: string;
  date: string;
  verified: boolean;
  isEvent: boolean;
  ruleVersion: string | null;
  rulePath: string | null;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function collectNodes(input: LifecycleInput): { known: Known[]; unknowns: LifecycleEventInput[] } {
  const known: Known[] = [
    { key: "issued", label: "Issued", date: input.issueDate, verified: true, isEvent: false, ruleVersion: null, rulePath: null },
  ];
  if (input.staleSince) {
    known.push({ key: "stale", label: "Stale", date: input.staleSince, verified: true, isEvent: false, ruleVersion: null, rulePath: null });
  }
  const unknowns: LifecycleEventInput[] = [];
  for (const e of input.events) {
    if (e.status === "ok" && e.date) {
      known.push({
        key: e.key, label: e.label, date: e.date, verified: e.verified, isEvent: true,
        ruleVersion: e.ruleVersion ?? null, rulePath: e.rulePaths?.[0] ?? null,
      });
    } else {
      unknowns.push(e);
    }
  }
  const sorted = [...known].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { known: sorted, unknowns };
}

// ---------------------------------------------------------------------------------------------------------------------
// Horizontal label placement
// ---------------------------------------------------------------------------------------------------------------------

interface PlaceItem {
  key: string;
  kind: LcLabelKind;
  /** Anchor x: the node marker (leader) or marker line the label belongs to. */
  x: number;
  w: number;
  h: number;
  sides: LcSide[];
  hasLeader: boolean;
  /** Fixed alignment preference (captions), otherwise middle, then start, then end are tried. */
  aligns: LcAlign[];
  /** Optional items (ticks) are dropped instead of failing the layout. */
  optional: boolean;
  /** Only row 0 (ticks, captions). */
  row0Only: boolean;
  /** start/end candidates sit beside x (clear of a leader there) instead of overlapping it. */
  beside?: boolean;
}

interface Placed {
  item: PlaceItem;
  side: LcSide;
  row: number;
  x0: number;
  x1: number;
  align: LcAlign;
}

function slotOrder(sides: LcSide[], row0Only: boolean): Array<{ side: LcSide; row: number }> {
  const out: Array<{ side: LcSide; row: number }> = [];
  const rows = row0Only ? 1 : MAX_ROW;
  for (let r = 0; r < rows; r++) for (const s of sides) out.push({ side: s, row: r });
  return out;
}

function candidateX(it: PlaceItem, align: LcAlign, width: number): { x0: number; align: LcAlign } {
  const off = it.beside ? -LEADER_CLEAR - 2 : 6;
  const raw = align === "middle" ? it.x - it.w / 2 : align === "start" ? it.x - off : it.x + off - it.w;
  const x0 = clamp(raw, EDGE, Math.max(EDGE, width - EDGE - it.w));
  // A label pushed in from an edge reads from that edge.
  if (x0 > raw + 0.5) return { x0, align: "start" };
  if (x0 < raw - 0.5) return { x0, align: "end" };
  return { x0, align };
}

function fitsSlot(placed: Placed[], it: PlaceItem, side: LcSide, row: number, x0: number, x1: number): boolean {
  for (const p of placed) {
    if (p.side !== side) continue;
    if (p.row === row && x0 < p.x1 + H_GAP && p.x0 < x1 + H_GAP) return false;
    // My leader crosses an inner row: it must not run through a label there.
    if (it.hasLeader && p.row < row && it.x > p.x0 - LEADER_CLEAR && it.x < p.x1 + LEADER_CLEAR) return false;
    // An outer-row leader must not run through me.
    if (p.item.hasLeader && p.row > row && p.item.x > x0 - LEADER_CLEAR && p.item.x < x1 + LEADER_CLEAR) return false;
  }
  return true;
}

function place(items: PlaceItem[], width: number): { placed: Placed[]; fits: boolean } {
  const placed: Placed[] = [];
  let fits = true;
  for (const it of items) {
    let done = false;
    for (const { side, row } of slotOrder(it.sides, it.row0Only)) {
      for (const pref of it.aligns) {
        const { x0, align } = candidateX(it, pref, width);
        const x1 = x0 + it.w;
        if (x1 > width - EDGE + 0.01 && it.w <= width - 2 * EDGE) continue;
        if (fitsSlot(placed, it, side, row, x0, x1)) {
          placed.push({ item: it, side, row, x0, x1, align });
          done = true;
          break;
        }
      }
      if (done) break;
    }
    if (!done && !it.optional) fits = false;
  }
  return { placed, fits };
}

interface NodeText {
  lines: string[];
  date: string;
}

function nodeText(n: LifecycleNode, maxLabelW: number): NodeText {
  return {
    lines: wrapText(n.label, maxLabelW, LC_TYPE.labelSize),
    date: n.date ? formatLifecycleDate(n.date) : n.reason === "not_applicable" ? "N/A" : "Unknown",
  };
}

function nodeSize(t: NodeText, unverified: boolean): { w: number; h: number } {
  const labelW = Math.max(...t.lines.map((l) => textWidth(l, LC_TYPE.labelSize)));
  const dateW = textWidth(t.date, LC_TYPE.dateSize, "mono");
  const w = Math.max(labelW, dateW, unverified ? LC_TYPE.badgeW : 0);
  const h = t.lines.length * LC_TYPE.labelLine + LC_TYPE.dateLine + (unverified ? LC_TYPE.badgeGap + LC_TYPE.badgeH : 0);
  return { w, h };
}

const captionW = (s: string) => textWidth(s, LC_TYPE.captionSize, "mono", LC_TYPE.captionTracking);

/** Groups stages whose markers sit within CLUSTER_PX of the previous one (the Unknown lane is its own group). */
function clusterNodes(nodes: LifecycleNode[]): LifecycleNode[][] {
  const out: LifecycleNode[][] = [];
  for (const n of nodes) {
    const cur = out[out.length - 1];
    const prev = cur?.[cur.length - 1];
    if (cur && prev && (prev.state === "unknown") === (n.state === "unknown") && n.x - prev.x < CLUSTER_PX) cur.push(n);
    else out.push([n]);
  }
  return out;
}

function anchorX(x0: number, x1: number, align: LcAlign): number {
  return align === "start" ? x0 : align === "end" ? x1 : (x0 + x1) / 2;
}

interface HorizontalArgs {
  width: number;
  nodes: LifecycleNode[];
  todayX: number;
  ticks: LifecycleTick[];
  lane: { x0: number; x1: number } | null;
  showTicks: boolean;
}

function layoutHorizontal({ width, nodes, todayX, ticks, lane, showTicks }: HorizontalArgs): { h: LcHorizontal; rows: Map<string, number> } {
  const maxLabelW = clamp(Math.round(width * 0.22), 96, 150);
  const texts = new Map(nodes.map((n) => [n.key, nodeText(n, maxLabelW)]));
  const items: PlaceItem[] = [];
  const base = { hasLeader: false, optional: false, row0Only: true } as const;
  // The Unknown lane caption hangs off the lane's right edge, away from TODAY (often at the end of the dated track).
  if (lane) items.push({ ...base, key: "__lane", kind: "lane", x: lane.x1 + 2, w: captionW("UNKNOWN"), h: CAPTION_H, sides: ["above"], aligns: ["end"] });
  const clusters = clusterNodes(nodes);
  // TODAY on (or right next to) a stage joins that stage's label as a caption line: one leader, no fight for space.
  const todayCluster = clusters.find((c) => c[0]!.state !== "unknown" && c.some((n) => Math.abs(n.x - todayX) < CLUSTER_PX)) ?? null;
  for (const c of clusters) {
    const sizes = c.map((n) => nodeSize(texts.get(n.key)!, n.unverified));
    const withToday = c === todayCluster;
    items.push({
      key: c[0]!.key, kind: "node", x: c[0]!.x, hasLeader: true, optional: false, row0Only: false,
      w: Math.max(...sizes.map((z) => z.w), withToday ? captionW("TODAY") : 0),
      h: sizes.reduce((a, z) => a + z.h, 0) + (c.length - 1) * PART_GAP + (withToday ? CAPTION_H + PART_GAP : 0),
      // Unknown-lane labels stay inside the lane box, which hangs below the rail.
      sides: c[0]!.state === "unknown" ? ["below"] : ["below", "above"],
      aligns: ["middle", "start", "end"],
    });
  }
  // TODAY goes after the stages, in the row next to the rail, beside its marker line if a stage's leader runs there.
  if (!todayCluster) items.push({ ...base, key: "__today", kind: "today", x: todayX, w: captionW("TODAY"), h: CAPTION_H, sides: ["above", "below"], aligns: ["middle", "start", "end"], beside: true });
  if (showTicks) {
    for (const t of ticks) {
      items.push({ ...base, key: `__tick-${t.date}`, kind: "tick", x: t.x, w: textWidth(formatLifecycleDate(t.date), 10, "mono"), h: CAPTION_H, sides: ["above"], aligns: ["middle"], optional: true });
    }
  }
  const { placed, fits } = place(items, width);

  // Row heights, then y positions: above rows stack upward from the rail, below rows downward.
  const rowH = { above: [] as number[], below: [] as number[] };
  for (const p of placed) rowH[p.side][p.row] = Math.max(rowH[p.side][p.row] ?? 0, p.item.h);
  const stack = (hs: number[]) => hs.reduce((a, h) => a + (h ?? 0), 0) + Math.max(0, hs.filter((h) => h).length - 1) * ROW_GAP;
  const aboveH = stack(rowH.above);
  const belowH = stack(rowH.below);
  const axisY = TOP_PAD + aboveH + RAIL_GAP;
  const height = axisY + (belowH > 0 ? RAIL_GAP + belowH : RAIL_GAP) + BOTTOM_PAD;

  const rowEdge = (side: LcSide, row: number): number => {
    let edge = side === "above" ? axisY - RAIL_GAP : axisY + RAIL_GAP;
    for (let r = 0; r < row; r++) edge += (side === "above" ? -1 : 1) * ((rowH[side][r] ?? 0) + ROW_GAP);
    return edge;
  };

  const rows = new Map<string, number>();
  const labels: LcLabel[] = placed.map((p) => {
    const edge = rowEdge(p.side, p.row);
    const y0 = p.side === "above" ? edge - p.item.h : edge;
    const box: LcBox = { x0: p.x0, y0, x1: p.x1, y1: y0 + p.item.h };
    const textX = anchorX(p.x0, p.x1, p.align);
    if (p.item.kind !== "node") {
      const text = p.item.kind === "today" ? "TODAY" : p.item.kind === "lane" ? "UNKNOWN" : formatLifecycleDate(p.item.key.slice(7));
      return { key: p.item.key, keys: [], today: p.item.kind === "today", kind: p.item.kind, side: p.side, row: p.row, align: p.align, textX, box, lines: [{ text, y: box.y1 - 2, role: "caption" }], badges: [], leader: null };
    }
    const cluster = clusters.find((c) => c[0]!.key === p.item.key)!;
    const lines: LcTextLine[] = [];
    const badges: Array<{ x: number; y: number }> = [];
    const badgeX = p.align === "start" ? p.x0 : p.align === "end" ? p.x1 - LC_TYPE.badgeW : textX - LC_TYPE.badgeW / 2;
    let top = y0;
    const today = cluster === todayCluster;
    if (today) {
      lines.push({ text: "TODAY", y: top + CAPTION_H - 2, role: "caption" });
      top += CAPTION_H + PART_GAP;
    }
    for (const node of cluster) {
      rows.set(node.key, p.row);
      const t = texts.get(node.key)!;
      t.lines.forEach((text, i) => lines.push({ text, y: top + (i + 1) * LC_TYPE.labelLine - 3, role: "label" }));
      top += t.lines.length * LC_TYPE.labelLine;
      lines.push({ text: t.date, y: top + LC_TYPE.dateLine - 3, role: "date", key: node.key });
      top += LC_TYPE.dateLine;
      if (node.unverified) {
        badges.push({ x: badgeX, y: top + LC_TYPE.badgeGap });
        top += LC_TYPE.badgeGap + LC_TYPE.badgeH;
      }
      top += PART_GAP;
    }
    const lx = cluster[0]!.x;
    const leader = p.side === "below" ? { x: lx, y0: axisY + 8, y1: y0 - 3 } : { x: lx, y0: box.y1 + 3, y1: axisY - 8 };
    return { key: p.item.key, keys: cluster.map((n) => n.key), today, kind: "node", side: p.side, row: p.row, align: p.align, textX, box, lines, badges, leader };
  });

  const laneRect = lane ? { x0: lane.x0 - 8, y0: axisY - 14, x1: lane.x1 + 8, y1: height - 2 } : null;
  return { h: { fits, height, axisY, labels, laneRect }, rows };
}

// ---------------------------------------------------------------------------------------------------------------------
// Vertical list (narrow containers)
// ---------------------------------------------------------------------------------------------------------------------

function layoutVertical(width: number, nodes: LifecycleNode[], asOf: string): LcVertical {
  const textW = Math.max(40, width - LC_VERTICAL.railCol);
  const dated = nodes.filter((n) => n.state !== "unknown");
  const todayAt = dated.filter((n) => (n.date ?? "") <= asOf).length;
  type Draft = { kind: "node"; node: LifecycleNode } | { kind: "today" };
  const seq: Draft[] = dated.map((node) => ({ kind: "node" as const, node }));
  seq.splice(todayAt, 0, { kind: "today" });
  // A point is "past" up to and including TODAY; the rail is blue from the first stage down to the TODAY row.
  const isPast = (d: Draft) => d.kind === "today" || d.node.state === "past";
  let y = 0;
  const rowOf = (d: Draft): LcVerticalItem => {
    const i = seq.indexOf(d);
    const segBefore: LcSegment | null = i === 0 ? null : isPast(d) ? "past" : "future";
    const after = seq[i + 1];
    const segAfter: LcSegment | null = !after ? null : isPast(after) ? "past" : "future";
    if (d.kind === "today") {
      const box = { x0: LC_VERTICAL.railCol, y0: y, x1: width, y1: y + LC_VERTICAL.todayH };
      y = box.y1;
      return { kind: "today", date: asOf, segBefore, segAfter, box };
    }
    return nodeRow(d.node, segBefore, segAfter);
  };
  const nodeRow = (node: LifecycleNode, segBefore: LcSegment | null, segAfter: LcSegment | null): LcVerticalItem => {
    const lines = wrapText(node.label, textW, 13);
    const h = 2 * LC_VERTICAL.rowPadY + lines.length * LC_VERTICAL.labelLine + LC_VERTICAL.dateLine + (node.unverified ? LC_VERTICAL.badgeLine : 0);
    const box = { x0: LC_VERTICAL.railCol, y0: y, x1: width, y1: y + h };
    y = box.y1;
    return { kind: "node", node, lines, segBefore, segAfter, box };
  };
  const items = seq.map(rowOf);
  const unknown = nodes.filter((n) => n.state === "unknown").map((n) => nodeRow(n, null, null));
  return { items, unknown, height: y };
}

// ---------------------------------------------------------------------------------------------------------------------

/** Share of a stage's position that comes from its date; the rest comes from its rank (see railScale). */
const TIME_WEIGHT = 0.4;

/**
 * Monotonic rail scale. Legal dates bunch up (years of dormancy, then report, remit and the DD window within months),
 * so a purely linear axis piles the late stages on top of each other. Each distinct date gets a position blended from
 * its time fraction and its rank; any other date (today, ticks) is interpolated between its neighbours, so order and
 * "between" are always exact while the spacing stays readable.
 */
function railScale(sortedDates: string[], x0: number, x1: number): (iso: string) => number {
  const uniq = [...new Set(sortedDates)];
  const days = uniq.map(dayNumber);
  const d0 = days[0] ?? 0;
  const span = (days[days.length - 1] ?? d0) - d0;
  if (uniq.length < 2 || span === 0) return () => x0;
  const pos = days.map((d, i) => x0 + (TIME_WEIGHT * ((d - d0) / span) + (1 - TIME_WEIGHT) * (i / (uniq.length - 1))) * (x1 - x0));
  return (iso: string) => {
    const d = dayNumber(iso);
    if (d <= d0) return x0;
    for (let i = 1; i < days.length; i++) {
      const a = days[i - 1]!;
      const b = days[i]!;
      if (d <= b) return pos[i - 1]! + ((d - a) / (b - a)) * (pos[i]! - pos[i - 1]!);
    }
    return x1;
  };
}

export function layoutLifecycle(input: LifecycleInput, width: number, options: LifecycleOptions = {}): LifecycleLayout {
  const w = Math.max(Math.round(width), PAD * 2 + 40);
  const { known, unknowns } = collectNodes(input);

  const laneWidth = unknowns.length > 0 ? Math.min(unknowns.length * UNKNOWN_SLOT, w * 0.4) : 0;
  const trackStart = PAD;
  const trackEnd = w - PAD - (laneWidth > 0 ? laneWidth + PAD : 0);

  const dates = [...known.map((k) => k.date), input.asOf].sort();
  const first = dates[0] ?? input.asOf;
  const last = dates[dates.length - 1] ?? input.asOf;
  const linear = scaleTime([first, last], [trackStart, trackEnd]);
  const scale = railScale(dates, trackStart, trackEnd);

  // "next" = earliest known node strictly after asOf.
  const nextIdx = known.findIndex((k) => k.date > input.asOf);
  const nodes: LifecycleNode[] = known.map((k, i) => {
    const state: NodeState = i === nextIdx ? "next" : k.date <= input.asOf ? "past" : "future";
    const urgent = state === "next" && daysBetween(input.asOf, k.date) <= URGENT_DAYS;
    return {
      key: k.key, label: k.label, date: k.date, x: scale(k.date), row: -1, state, urgent,
      unverified: k.isEvent && !k.verified, reason: null, ruleVersion: k.ruleVersion, rulePath: k.rulePath,
    };
  });

  let unknownLane: LifecycleLayout["unknownLane"] = null;
  if (unknowns.length > 0) {
    const x0 = trackEnd + PAD;
    const x1 = w - PAD;
    unknownLane = { x0, x1 };
    const slot = (x1 - x0) / unknowns.length;
    unknowns.forEach((e, i) => {
      nodes.push({
        key: e.key, label: e.label, date: null, x: x0 + slot * (i + 0.5), row: -1, state: "unknown",
        urgent: false, unverified: false, reason: e.status === "not_applicable" ? "not_applicable" : "unknown",
        ruleVersion: e.ruleVersion ?? null, rulePath: e.rulePaths?.[0] ?? null,
      });
    });
  }

  const todayX = scale(input.asOf);
  const ticks = linear.ticks(4).map((date) => ({ date, x: scale(date) }));
  const { h: horizontal, rows } = layoutHorizontal({ width: w, nodes, todayX, ticks, lane: unknownLane, showTicks: options.ticks ?? false });
  const placedNodes = nodes.map((n) => ({ ...n, row: rows.get(n.key) ?? -1 }));
  const orientation = w < VERTICAL_BELOW || !horizontal.fits ? "vertical" : "horizontal";

  return {
    width: w,
    orientation,
    trackStart,
    trackEnd,
    nodes: placedNodes,
    todayX,
    progressEnd: Math.max(trackStart, Math.min(todayX, trackEnd)),
    ticks,
    unknownLane,
    horizontal,
    vertical: layoutVertical(w, placedNodes, input.asOf),
  };
}

/** True when two boxes share any area (touching edges do not count). */
export function boxesIntersect(a: LcBox, b: LcBox): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}
