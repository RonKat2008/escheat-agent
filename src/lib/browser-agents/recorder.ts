import { mkdirSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { agentRuns } from "@/db/schema";
import { estimateCostMicros } from "@/lib/llm/pricing";
import { BASE_TIMEOUTS, settledWithin } from "./timeouts";

export const ARTIFACTS_ROOT = path.join(".data", "agent-artifacts");

export type StepKind = "info" | "action" | "extract" | "screenshot" | "paused" | "approval" | "guard_blocked" | "error" | "done";

export interface TraceStep {
  at: string;
  kind: StepKind;
  message: string;
  /** Path relative to the repo root, under .data/agent-artifacts/<runId>/ */
  screenshot?: string;
  data?: Record<string, unknown>;
}

export interface ScreenshotPage {
  screenshot(opts: { path: string; fullPage?: boolean; timeout?: number }): Promise<unknown>;
}

export interface RecorderOptions {
  /** R9-01: how long step()/finish() wait for their DB write before the agent moves on (the write still lands, in order). */
  writeWaitMs?: number;
  /** Screenshot time limit per trace step. */
  shotMs?: number;
}

export type DriveMode = "stagehand" | "scripted";

export const SCRIPTED_LABEL = "SCRIPTED - no model configured";
export const SCRIPTED_OFFLINE_LABEL = "SCRIPTED (offline) - deterministic, no model calls";

/** Model usage for a run; `model: null` means no model was called (scripted), so cost is exactly zero. */
export interface RunUsage {
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
}

/** Zero for scripted runs, a price-table estimate for live ones, null when the model has no known price. */
export function usageCostMicros(u: RunUsage): number | null {
  if (u.model === null) return 0;
  return estimateCostMicros(u.model.replace(/^anthropic\//, ""), {
    inputTokens: u.inputTokens,
    outputTokens: u.outputTokens,
    cacheReadTokens: u.cacheReadTokens ?? 0,
    cacheCreationTokens: 0,
    webSearchRequests: 0,
  });
}

/**
 * Persists a run's trace + output to agent_runs after every step, so /runs shows live progress. Writes are serialized
 * on one chain; the agent waits for each at most `writeWaitMs` (R9-01), so a busy database slows the trace, never the
 * browser steps, and a run can always finish and free its slot.
 */
export class RunRecorder {
  readonly steps: TraceStep[] = [];
  readonly screenshots: string[] = [];
  readonly dir: string;
  output: Record<string, unknown> = {};
  private chain: Promise<void> = Promise.resolve();
  private shotCounter = 0;
  private readonly writeWaitMs: number;
  private readonly shotMs: number;

  constructor(
    private readonly db: Db,
    readonly runId: string,
    private readonly now: () => Date = () => new Date(),
    opts: RecorderOptions = {},
  ) {
    this.writeWaitMs = opts.writeWaitMs ?? BASE_TIMEOUTS.recorderWaitMs;
    this.shotMs = opts.shotMs ?? BASE_TIMEOUTS.shotMs;
    this.dir = path.join(ARTIFACTS_ROOT, runId);
    mkdirSync(this.dir, { recursive: true });
  }

  async step(kind: StepKind, message: string, extra: { data?: Record<string, unknown>; page?: ScreenshotPage; shotName?: string } = {}): Promise<TraceStep> {
    const entry: TraceStep = { at: this.now().toISOString(), kind, message };
    if (extra.data) entry.data = extra.data;
    if (extra.page) {
      const rel = await this.shot(extra.page, extra.shotName ?? kind).catch(() => undefined);
      if (rel) entry.screenshot = rel;
    }
    this.steps.push(entry);
    await this.settle(this.flush());
    return entry;
  }

  private async shot(page: ScreenshotPage, name: string): Promise<string> {
    const file = `${String(++this.shotCounter).padStart(2, "0")}-${name.replace(/[^a-z0-9_-]+/gi, "-")}.png`;
    const rel = path.join(this.dir, file);
    await page.screenshot({ path: rel, fullPage: true, timeout: this.shotMs });
    this.screenshots.push(rel);
    return rel;
  }

  setOutput(patch: Record<string, unknown>): void {
    this.output = { ...this.output, ...patch };
  }

  /** Waits for a queued write at most writeWaitMs; a slower write keeps going on the chain. */
  private async settle(write: Promise<void>): Promise<void> {
    if (!(await settledWithin(write, this.writeWaitMs))) {
      console.warn(`[browser-agent] run ${this.runId}: trace write still pending after ${this.writeWaitMs} ms; continuing`);
    }
  }

  /** Queues a write on the serialized chain; failures are logged, never thrown into the agent. */
  private enqueue(label: string, write: () => Promise<unknown>): Promise<void> {
    this.chain = this.chain.then(async () => {
      try {
        await write();
      } catch (err) {
        console.error(`[browser-agent] failed to ${label}:`, err);
      }
    });
    return this.chain;
  }

  /** Serialized DB write of the trace + output (snapshotted now). Resolves when it landed. */
  flush(): Promise<void> {
    const trace = [...this.steps];
    const output = { ...this.output, screenshots: [...this.screenshots] };
    return this.enqueue("persist trace", () => this.db.update(agentRuns).set({ trace, output }).where(eq(agentRuns.id, this.runId)));
  }

  /** Settles the run row (after every queued trace write). Waits for it at most writeWaitMs; it still lands after. */
  async finish(status: "succeeded" | "failed", error?: string, usage?: RunUsage): Promise<void> {
    const values = {
      status,
      error,
      ...(usage ? { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, costUsdMicros: usageCostMicros(usage) } : {}),
      finishedAt: this.now(),
      trace: [...this.steps],
      output: { ...this.output, screenshots: [...this.screenshots] },
    };
    await this.settle(this.enqueue("finish run row", () => this.db.update(agentRuns).set(values).where(eq(agentRuns.id, this.runId))));
  }
}
