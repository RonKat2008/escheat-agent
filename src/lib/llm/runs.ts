import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { agentRuns } from "@/db/schema";

export interface RunStart {
  agent: string;
  /** Null when no model was called (a deterministic Ask card turn). */
  model: string | null;
  /** Free-form subject (item id, state code, ...). The schema has no subject column, so it lives in `input`. */
  subjectId?: string;
  /** Real FK targets; only pass ids that exist. */
  companyId?: string;
  staleItemId?: string;
  input: Record<string, unknown>;
  /** "card" = a deterministic Ask card turn (R11-03): no model key was used, zero tokens, zero cost.
   * "replay" = answered from a recorded cassette (ESCHEAT_OFFLINE): no model was called and nothing was billed. */
  mode?: "replay" | "card";
}

export interface RunFinish {
  status: "succeeded" | "failed" | "cancelled";
  model: string | null;
  output?: Record<string, unknown>;
  trace: unknown[];
  inputTokens: number;
  outputTokens: number;
  costUsdMicros: number | null;
  error?: string;
}

/** Insert a `running` agent_runs row. Logging problems are reported, not fatal to the caller. */
export async function startRun(db: Db, run: RunStart): Promise<string | undefined> {
  try {
    const [row] = await db
      .insert(agentRuns)
      .values({
        agent: run.agent,
        model: run.model,
        status: "running",
        companyId: run.companyId,
        staleItemId: run.staleItemId,
        input: { ...run.input, subjectId: run.subjectId ?? null, ...(run.mode ? { mode: run.mode } : {}) },
      })
      .returning({ id: agentRuns.id });
    return row?.id;
  } catch (err) {
    console.error("[llm] failed to write agent_runs start row:", err);
    return undefined;
  }
}

export async function finishRun(db: Db, runId: string | undefined, fin: RunFinish): Promise<void> {
  if (!runId) return;
  try {
    await db
      .update(agentRuns)
      .set({
        status: fin.status,
        model: fin.model,
        output: fin.output,
        trace: fin.trace,
        inputTokens: fin.inputTokens,
        outputTokens: fin.outputTokens,
        costUsdMicros: fin.costUsdMicros,
        error: fin.error,
        finishedAt: new Date(),
      })
      .where(eq(agentRuns.id, runId));
  } catch (err) {
    console.error("[llm] failed to write agent_runs finish row:", err);
  }
}
