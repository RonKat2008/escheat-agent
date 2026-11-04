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
