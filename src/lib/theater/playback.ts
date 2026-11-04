/** Pure playback rules for the theater (no React), so the timing is unit tested. */
import type { TheaterStep } from "./steps";

export const SPEEDS = [1, 2, 4] as const;
export type Speed = (typeof SPEEDS)[number];

/** How long one step holds the stage at 1×. */
export const STEP_MS = 1400;
/** Live runs are re-read this often (no websockets). */
export const LIVE_POLL_MS = 2000;

/** The approval gate holds the token twice as long: a person had to act there. */
export function holdMs(step: TheaterStep | undefined, speed: Speed): number {
  const base = step?.stage === "approval" ? STEP_MS * 2 : STEP_MS;
  return Math.round(base / speed);
}

/**
 * Where the cursor goes when a live poll returns `nextLength` steps. A viewer sitting on the latest step follows the
 * run; one who scrolled back stays put.
 */
export function followCursor(cursor: number, prevLength: number, nextLength: number): number {
  if (nextLength === 0) return 0;
  if (cursor >= prevLength - 1) return nextLength - 1;
  return Math.min(cursor, nextLength - 1);
}

/** The token is parked at the gate: the current step is an approval step and nothing recorded follows it. */
export function isWaitingAtGate(steps: readonly TheaterStep[], cursor: number): boolean {
  const s = steps[cursor];
  return Boolean(s && s.stage === "approval" && cursor === steps.length - 1);
}

/**
 * Honest provenance for token counts (R9-05). A replayed or scripted run made no new model call, so any tokens shown
 * were recorded from the original answer and nothing was spent now. A live model run's counts are what it used.
 */
export function tokenProvenance(run: { replay: boolean; noModel: boolean }): string | null {
  if (run.replay) return "recorded, not spent";
  if (run.noModel) return "recorded; no model call";
  return null;
}

export interface PickerRun {
  id: string;
  kind: "filing" | "recovery" | "other";
  agent: string;
  label: string;
  startedAt: string;
}

export interface PickerGroup<T extends PickerRun = PickerRun> {
  key: string;
  label: string;
  runs: T[];
}

const KIND_ORDER = ["filing", "recovery"] as const;

/**
 * Groups the picker's runs by agent so every run type is reachable: filing first, recovery second, then the rest in
 * the order their newest run appears. Each group keeps newest-first order.
 */
export function groupPickerRuns<T extends PickerRun>(runs: readonly T[]): PickerGroup<T>[] {
  const groups = new Map<string, PickerGroup<T>>();
  for (const r of runs) {
    const g = groups.get(r.agent) ?? { key: r.agent, label: r.label, runs: [] };
    g.runs.push(r);
    groups.set(r.agent, g);
  }
  const rank = (g: PickerGroup<T>) => {
    const i = KIND_ORDER.indexOf(g.runs[0]!.kind as (typeof KIND_ORDER)[number]);
    return i < 0 ? KIND_ORDER.length : i;
  };
  return [...groups.values()].sort((a, b) => rank(a) - rank(b));
}
