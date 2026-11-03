/** Pure shaping of a run trace for the viewer: dev-noise removal and the shared time axis. Never invents a value. */
import { isDevNoise } from "@/components/b/trace-noise";
import type { TraceStepView } from "@/components/b/trace";
import { cleanFenceMessages, isDevFenceNoise } from "@/lib/browser-agents/fence-noise";

const rawOf = (s: TraceStepView): string | null => {
  const d = s.data as { raw?: unknown } | null;
  return d && typeof d === "object" && typeof d.raw === "string" ? d.raw : null;
};

/** True for a step that is dev-server plumbing (HMR sockets, fonts, chunks), not something the agent did. */
export function isDevStep(s: TraceStepView): boolean {
  if (s.kind === "dev_noise" || isDevNoise(s)) return true;
  if (s.kind !== "guard_blocked") return false;
  const raw = rawOf(s);
  return isDevFenceNoise(s.label) || (raw !== null && isDevFenceNoise(raw));
}

/**
 * Drops dev-server noise and rewords raw `[replica-fence]` lines in plain words. Real guard blocks (other hosts, app
 * paths) stay visible. Returns how many steps were hidden so the viewer can say so.
 */
export function cleanTrace(steps: readonly TraceStepView[]): { steps: TraceStepView[]; hidden: number } {
  const kept = steps.filter((s) => !isDevStep(s));
  const reworded = cleanFenceMessages(kept.map((s) => ({ ...s, message: s.label }))).map(({ message, ...s }) => ({ ...s, label: message }));
  return { steps: reworded, hidden: steps.length - kept.length };
}

export interface StepSpan {
  /** 0-1 offset of the step start on the run's time axis. */
  left: number;
  /** 0-1 share of the run the step took (0 when unknown). */
  width: number;
}

/**
 * Each step's place on one shared time axis (the mini Gantt): start offset and duration as shares of the run.
 * `endMs` is the run's finish (or "now" while live). Steps without a timestamp get no span.
 */
export function stepSpans(steps: readonly TraceStepView[], startMs: number, endMs: number): Map<number, StepSpan> {
  const out = new Map<number, StepSpan>();
  const total = endMs - startMs;
  if (!Number.isFinite(total) || total <= 0) return out;
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  for (const s of steps) {
    const at = s.at ? Date.parse(s.at) : NaN;
    if (!Number.isFinite(at)) continue;
    const left = clamp((at - startMs) / total);
    const width = s.durationMs != null ? Math.min(1 - left, clamp(s.durationMs / total)) : 0;
    out.set(s.index, { left, width });
  }
  return out;
}

/** Shot and video paths a run recorded. Only `.webm` video in the run output counts; nothing is guessed. */
export function runVideo(output: unknown): string | null {
  const v = output && typeof output === "object" ? (output as { video?: unknown }).video : null;
  return typeof v === "string" && v.toLowerCase().endsWith(".webm") ? v : null;
}

/** The step a live run is on: the last visible step. */
export const currentStepIndex = (steps: readonly TraceStepView[]): number | null => steps.at(-1)?.index ?? null;
