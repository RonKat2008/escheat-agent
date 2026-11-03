/**
 * Pure layout for the lifecycle tunnel (DESIGN-V3 §3.3): one ring per lifecycle stage, receding in depth, plus the
 * "today" plane between rings and the camera depth. No DOM, no React; unit tested in tunnel-model.test.ts.
 * Dates come from the rules engine (via explainItem); nothing here computes a legal date.
 */
import { daysBetween } from "@/components/viz/core/scales";

export const RING_GAP = 220;
export const PERSPECTIVE = 900;
export const MAX_RINGS = 8;
export const URGENT_DAYS = 7;

export interface TunnelStageInput {
  key: string;
  label: string;
  /** null when the engine could not compute it (rendered as Unknown, never estimated). */
  date: string | null;
  /** false only for rule-derived dates nobody has verified. */
  verified: boolean;
  /** true for the engine's legal dates (they carry a rule path); false for ledger facts like Issued. */
  legal: boolean;
  rulePath?: string | null;
}

export type RingState = "past" | "next" | "future" | "unknown";

export interface TunnelRing {
  key: string;
  label: string;
  date: string | null;
  index: number;
  state: RingState;
  /** The next ring and due within URGENT_DAYS: pink ring. */
  urgent: boolean;
  unverified: boolean;
  rulePath: string | null;
  /** translateZ of the ring in px (0, -220, -440, ...). */
  z: number;
  /** Rings between the camera and this ring (negative = behind the camera). */
  depth: number;
  opacity: number;
  /** false when the ring is behind the camera (hidden and not focusable). */
  visible: boolean;
}

export interface TunnelLayout {
  rings: TunnelRing[];
  /** translateZ of the "today" plane, or null when nothing is dated. */
  todayZ: number | null;
  /** Ring index the camera is parked at. */
  focus: number;
  /** translateZ for the camera container (moves the world toward the viewer). */
  cameraZ: number;
  nextIndex: number;
}

function ringState(stage: TunnelStageInput, nextKey: string | undefined, asOf: string): RingState {
  if (!stage.date) return "unknown";
  if (stage.key === nextKey) return "next";
  return stage.date < asOf ? "past" : "future";
}

/**
 * Where today sits, in ring units: between the last dated ring before asOf and the first dated ring on/after it, in
 * proportion to the days between them. Unknown rings are skipped. null when nothing is dated.
 */
export function todayDepth(stages: readonly Pick<TunnelStageInput, "date">[], asOf: string): number | null {
  const dated = stages.map((s, i) => ({ i, date: s.date })).filter((s): s is { i: number; date: string } => s.date !== null);
  if (dated.length === 0) return null;
  const after = dated.findIndex((s) => s.date >= asOf);
  if (after === -1) return dated[dated.length - 1]!.i + 0.5;
  if (after === 0) return Math.max(0, dated[0]!.i - 0.5);
  const a = dated[after - 1]!;
  const b = dated[after]!;
  const span = daysBetween(a.date, b.date);
  const frac = span <= 0 ? 0.5 : Math.min(1, Math.max(0, daysBetween(a.date, asOf) / span));
  return a.i + (b.i - a.i) * frac;
}

/** The ring the camera starts on: the next deadline, else the last dated ring, else 0. */
export function defaultFocus(stages: readonly TunnelStageInput[], nextKey: string | undefined): number {
  const n = nextKey ? stages.findIndex((s) => s.key === nextKey) : -1;
  if (n >= 0) return n;
  for (let i = stages.length - 1; i >= 0; i--) if (stages[i]!.date) return i;
  return 0;
}

export function clampFocus(focus: number, count: number): number {
  if (count <= 0) return 0;
  return Math.min(count - 1, Math.max(0, Math.round(focus)));
}

export function layoutTunnel(input: {
  stages: readonly TunnelStageInput[];
  asOf: string;
  nextKey?: string;
  focus?: number;
}): TunnelLayout {
  const stages = input.stages.slice(0, MAX_RINGS);
  const focus = clampFocus(input.focus ?? defaultFocus(stages, input.nextKey), stages.length);
  const rings: TunnelRing[] = stages.map((s, index) => {
    const state = ringState(s, input.nextKey, input.asOf);
    const urgent = state === "next" && s.date !== null && daysBetween(input.asOf, s.date) <= URGENT_DAYS;
    const depth = index - focus;
    const visible = depth >= 0;
    return {
      key: s.key,
      label: s.label,
      date: s.date,
      index,
      state,
      urgent,
      unverified: s.legal && s.date !== null && !s.verified,
      rulePath: s.rulePath ?? null,
      z: -index * RING_GAP || 0,
      depth,
      opacity: visible ? Math.max(0.28, 1 - depth * 0.16) : 0,
      visible,
    };
  });
  const td = todayDepth(stages, input.asOf);
  return {
    rings,
    todayZ: td === null ? null : -td * RING_GAP || 0,
    focus,
    cameraZ: focus * RING_GAP,
    nextIndex: input.nextKey ? stages.findIndex((s) => s.key === input.nextKey) : -1,
  };
}
