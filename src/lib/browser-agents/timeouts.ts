/**
 * R9-01: every wait a browser agent makes is bounded, so a run that cannot finish fails within about a minute with an
 * honest message instead of hanging for many minutes while the server (one Node process, one PGlite database, the
 * agent's own Chromium) is busy or the machine stalls.
 */
import type { DriveMode } from "./recorder";

export interface AgentTimeouts {
  /** Every Playwright action and locator wait (click, fill, innerText, waitFor, screenshot). */
  stepMs: number;
  /** Every navigation (goto, waitForURL). */
  navMs: number;
  /** Launching the fenced Chromium. */
  launchMs: number;
  /** The whole portal phase before the irreversible click: launch, sign in, upload, read and compare the summary. */
  portalDeadlineMs: number;
  /** How long an agent step waits for its run-trace write before moving on (the write still lands, in order). */
  recorderWaitMs: number;
  /** Screenshot on the trace; shorter than a step so a failing run reports quickly. */
  shotMs: number;
}

type Env = Record<string, string | undefined>;

/** Production values. `next dev` compiles a route on its first request, so dev gets 3x; Stagehand (model calls) 3x too. */
export const BASE_TIMEOUTS: AgentTimeouts = {
  stepMs: 20_000,
  navMs: 30_000,
  launchMs: 30_000,
  portalDeadlineMs: 60_000,
  recorderWaitMs: 5_000,
  shotMs: 10_000,
};

export function agentTimeouts(mode: DriveMode = "scripted", env: Env = process.env): AgentTimeouts {
  const factor = (env.NODE_ENV === "production" ? 1 : 3) * (mode === "stagehand" ? 3 : 1);
  if (factor === 1) return { ...BASE_TIMEOUTS };
  return {
    stepMs: BASE_TIMEOUTS.stepMs * factor,
    navMs: BASE_TIMEOUTS.navMs * factor,
    launchMs: BASE_TIMEOUTS.launchMs * factor,
    portalDeadlineMs: BASE_TIMEOUTS.portalDeadlineMs * factor,
    recorderWaitMs: BASE_TIMEOUTS.recorderWaitMs,
    shotMs: BASE_TIMEOUTS.shotMs,
  };
}

export class AgentDeadlineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentDeadlineError";
  }
}

/**
 * Resolves with `work`, or rejects with the error `onTimeout` returns once `ms` passed. `onTimeout` should also stop
 * the work (close the browser) so its pending steps fail fast; their late rejection is swallowed here.
 */
export function withDeadline<T>(work: Promise<T>, ms: number, onTimeout: () => Promise<Error> | Error): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      Promise.resolve()
        .then(onTimeout)
        .then(reject, reject);
    }, ms);
  });
  work.catch(() => undefined); // a rejection after the deadline already fired is not unhandled
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

/** True when `p` settled within `ms`; false when it is still pending (it keeps running). Never throws. */
export async function settledWithin(p: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), ms);
    timer.unref?.();
  });
  try {
    return await Promise.race([p.then(() => true as const, () => true as const), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** The run's error text when the whole portal phase outlived its deadline. */
export function portalDeadlineMessage(deadlineMs: number, step: string): string {
  return `The filing agent stopped after ${Math.round(deadlineMs / 1000)} s ${step}: the replica portal did not answer in time. Nothing was submitted.`;
}

/** Playwright's TimeoutError message carries an ANSI-colored call log; the run shows its first line, readable. */
export function isTimeoutError(err: unknown): boolean {
  return err instanceof Error && (err.name === "TimeoutError" || /Timeout \d+ms exceeded/.test(err.message));
}

/**
 * The run's error text for a timed-out step before anything was submitted: what it was doing, how long it waited,
 * and that nothing was submitted. `step` is a short "while ..." phrase.
 */
export function timeoutMessage(err: unknown, step: string): string {
  // Strip the ANSI color codes Playwright puts in its call log.
  const raw = (err instanceof Error ? err.message : String(err)).replace(/\u001b\[[0-9;]*m/g, "");
  const first = raw.split("\n")[0]!.trim();
  const waited = /Timeout (\d+)ms exceeded/.exec(first);
  const secs = waited ? `${Math.round(Number(waited[1]) / 1000)} s` : "the step time limit";
  const what = /waiting for (.+)$/m.exec(raw)?.[1]?.trim();
  return `The replica portal did not respond within ${secs} ${step}${what ? ` (waiting for ${what})` : ""}. Nothing was submitted.`;
}
