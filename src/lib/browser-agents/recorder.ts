import { mkdirSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { agentRuns } from "@/db/schema";

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
  screenshot(opts: { path: string; fullPage?: boolean }): Promise<unknown>;
}

export type DriveMode = "stagehand" | "scripted";

export const SCRIPTED_LABEL = "SCRIPTED - no model configured";

/** Persists a run's trace + output to agent_runs after every step, so /runs shows live progress. */
export class RunRecorder {
  readonly steps: TraceStep[] = [];
  readonly screenshots: string[] = [];
  readonly dir: string;
  output: Record<string, unknown> = {};
  private chain: Promise<void> = Promise.resolve();
  private shotCounter = 0;

  constructor(
    private readonly db: Db,
    readonly runId: string,
    private readonly now: () => Date = () => new Date(),
  ) {
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
    await this.flush();
    return entry;
  }

  private async shot(page: ScreenshotPage, name: string): Promise<string> {
    const file = `${String(++this.shotCounter).padStart(2, "0")}-${name.replace(/[^a-z0-9_-]+/gi, "-")}.png`;
    const rel = path.join(this.dir, file);
    await page.screenshot({ path: rel, fullPage: true });
    this.screenshots.push(rel);
    return rel;
  }

  setOutput(patch: Record<string, unknown>): void {
    this.output = { ...this.output, ...patch };
  }

  /** Serialized DB write; failures are logged, never thrown into the agent. */
  flush(): Promise<void> {
    this.chain = this.chain.then(async () => {
      try {
        await this.db
          .update(agentRuns)
          .set({ trace: [...this.steps], output: { ...this.output, screenshots: [...this.screenshots] } })
          .where(eq(agentRuns.id, this.runId));
      } catch (err) {
        console.error("[browser-agent] failed to persist trace:", err);
      }
    });
    return this.chain;
  }

  async finish(status: "succeeded" | "failed", error?: string): Promise<void> {
    await this.flush();
    try {
      await this.db
        .update(agentRuns)
        .set({
          status,
          error,
          finishedAt: this.now(),
          trace: [...this.steps],
          output: { ...this.output, screenshots: [...this.screenshots] },
        })
        .where(eq(agentRuns.id, this.runId));
    } catch (err) {
      console.error("[browser-agent] failed to finish run row:", err);
    }
  }
}
