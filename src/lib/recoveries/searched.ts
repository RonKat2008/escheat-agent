/**
 * Per-state "last searched" for the recoveries portal strip, read from the recovery agent's own per-state trace
 * steps (an extract step with data.state, or an info step whose message starts "XX:"). A state with no finds still
 * counts as searched; a state the run never reached stays null.
 */
export interface SearchRun {
  startedAt: Date;
  input: Record<string, unknown> | null;
  trace: unknown;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function stepState(step: Record<string, unknown>, states: readonly string[]): string | null {
  if (isObj(step.data) && typeof step.data.state === "string" && states.includes(step.data.state)) return step.data.state;
  if (typeof step.message === "string") {
    const m = /^([A-Z]{2}):/.exec(step.message);
    if (m && states.includes(m[1]!)) return m[1]!;
  }
  return null;
}

/** `runs` newest first. */
export function lastSearchedByState(runs: readonly SearchRun[], states: readonly string[]): Record<string, string | null> {
  const out: Record<string, string | null> = Object.fromEntries(states.map((s) => [s, null]));
  for (const run of runs) {
    const steps = Array.isArray(run.trace) ? run.trace.filter(isObj) : [];
    for (const step of steps) {
      const state = stepState(step, states);
      if (!state) continue;
      const at = typeof step.at === "string" && Number.isFinite(Date.parse(step.at)) ? new Date(step.at) : run.startedAt;
      const prev = out[state];
      if (!prev || at.getTime() > Date.parse(prev)) out[state] = at.toISOString();
    }
    if (states.every((s) => out[s])) break;
  }
  return out;
}
