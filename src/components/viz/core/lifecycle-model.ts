import { daysBetween, scaleTime } from "./scales";

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
  /** Label stagger row so neighbours do not collide (0..MAX_ROW). */
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

export interface LifecycleLayout {
  width: number;
  trackStart: number;
  trackEnd: number;
  nodes: LifecycleNode[];
  todayX: number;
  /** Progress segment runs from the first node to this x. */
  progressEnd: number;
  ticks: LifecycleTick[];
  /** x-range of the Unknown lane, or null when nothing is unknown. */
  unknownLane: { x0: number; x1: number } | null;
}

export const URGENT_DAYS = 7;
export const MAX_ROW = 2;
const LABEL_GAP = 96;
const PAD = 24;
const UNKNOWN_SLOT = 96;

function assignRows(xs: number[]): number[] {
  const lastX: number[] = [];
  return xs.map((x) => {
    for (let r = 0; r <= MAX_ROW; r++) {
      const prev = lastX[r];
      if (prev === undefined || x - prev >= LABEL_GAP) {
        lastX[r] = x;
        return r;
      }
    }
    // Everything crowded: reuse the row whose last label is furthest away.
    let best = 0;
    for (let r = 1; r <= MAX_ROW; r++) if ((lastX[r] ?? -Infinity) < (lastX[best] ?? -Infinity)) best = r;
    lastX[best] = x;
    return best;
  });
}

interface Known {
  key: string;
  label: string;
  date: string;
  verified: boolean;
  isEvent: boolean;
  ruleVersion: string | null;
  rulePath: string | null;
}

export function layoutLifecycle(input: LifecycleInput, width: number): LifecycleLayout {
  const w = Math.max(width, PAD * 2 + 40);
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
  known.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const laneWidth = unknowns.length > 0 ? Math.min(unknowns.length * UNKNOWN_SLOT, w * 0.4) : 0;
  const trackStart = PAD;
  const trackEnd = w - PAD - (laneWidth > 0 ? laneWidth + PAD : 0);

  const dates = [...known.map((k) => k.date), input.asOf].sort();
  const first = dates[0] ?? input.asOf;
  const last = dates[dates.length - 1] ?? input.asOf;
  const scale = scaleTime([first, last], [trackStart, trackEnd]);

  // "next" = earliest known node strictly after asOf.
  const nextIdx = known.findIndex((k) => k.date > input.asOf);
  const xs = known.map((k) => scale(k.date));
  const rows = assignRows(xs);

  const nodes: LifecycleNode[] = known.map((k, i) => {
    const state: NodeState = i === nextIdx ? "next" : k.date <= input.asOf ? "past" : "future";
    const urgent = state === "next" && daysBetween(input.asOf, k.date) <= URGENT_DAYS;
    return {
      key: k.key, label: k.label, date: k.date, x: xs[i] ?? trackStart, row: rows[i] ?? 0, state, urgent,
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
        key: e.key, label: e.label, date: null, x: x0 + slot * (i + 0.5), row: i % (MAX_ROW + 1), state: "unknown",
        urgent: false, unverified: false, reason: e.status === "not_applicable" ? "not_applicable" : "unknown",
        ruleVersion: e.ruleVersion ?? null, rulePath: e.rulePaths?.[0] ?? null,
      });
    });
  }

  const todayX = scale(input.asOf);
  return {
    width: w,
    trackStart,
    trackEnd,
    nodes,
    todayX,
    progressEnd: Math.max(trackStart, Math.min(todayX, trackEnd)),
    ticks: scale.ticks(4).map((date) => ({ date, x: scale(date) })),
    unknownLane,
  };
}
