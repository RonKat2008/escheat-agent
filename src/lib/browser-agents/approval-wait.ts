import type { Approval } from "@/db/schema";
import { ApprovalRequiredError } from "@/lib/approvals";

export class ApprovalTimeoutError extends Error {
  constructor(public readonly waitedMs: number) {
    super(`Timed out after ${Math.round(waitedMs / 1000)}s waiting for human approval.`);
    this.name = "ApprovalTimeoutError";
  }
}

export class ApprovalWaitAbortedError extends Error {
  constructor() {
    super("Wait for approval was cancelled.");
    this.name = "ApprovalWaitAbortedError";
  }
}

export const DEFAULT_POLL_INTERVAL_MS = 2_000;
export const DEFAULT_APPROVAL_TIMEOUT_MS = 30 * 60_000;

export interface WaitForApprovalOptions {
  /** Non-consuming check, normally `assertApproved(db, ref)`. Throws ApprovalRequiredError when not (yet) approved. */
  check: () => Promise<Approval>;
  intervalMs?: number;
  timeoutMs?: number;
  /** Injected for tests. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Called once per poll that did not release, with the reason. */
  onWaiting?: (info: { attempt: number; reason: string; elapsedMs: number }) => void;
  signal?: AbortSignal;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Polls until a usable approval exists. Never performs the gated action itself: the caller
 * runs the action inside `withApproval`, which atomically consumes the approval.
 * "none" and "payload_changed" keep waiting (a wrong-checksum approval does not release);
 * "consumed" is terminal because the approval was spent by someone else.
 */
export async function waitForApproval(opts: WaitForApprovalOptions): Promise<Approval> {
  const interval = opts.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const timeout = opts.timeoutMs ?? DEFAULT_APPROVAL_TIMEOUT_MS;
  const sleep = opts.sleep ?? realSleep;
  const now = opts.now ?? Date.now;
  const start = now();
  for (let attempt = 1; ; attempt++) {
    if (opts.signal?.aborted) throw new ApprovalWaitAbortedError();
    try {
      return await opts.check();
    } catch (err) {
      if (!(err instanceof ApprovalRequiredError) || err.reason === "consumed") throw err;
      const elapsed = now() - start;
      opts.onWaiting?.({ attempt, reason: err.reason, elapsedMs: elapsed });
      if (elapsed + interval > timeout) throw new ApprovalTimeoutError(elapsed);
    }
    await sleep(interval);
  }
}
