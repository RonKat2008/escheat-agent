/**
 * Single source of truth for model ids. Override per environment with
 * ORCHESTRATOR_MODEL / WORKER_MODEL.
 *
 * - ORCHESTRATOR_MODEL: edge cases, rule research, report checks.
 * - WORKER_MODEL: bulk classification, reply parsing.
 */
export const DEFAULT_ORCHESTRATOR_MODEL = "claude-opus-5-5";
export const DEFAULT_WORKER_MODEL = "claude-haiku-5-5";

function pick(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : fallback;
}

export const ORCHESTRATOR_MODEL = pick(process.env.ORCHESTRATOR_MODEL, DEFAULT_ORCHESTRATOR_MODEL);
export const WORKER_MODEL = pick(process.env.WORKER_MODEL, DEFAULT_WORKER_MODEL);
