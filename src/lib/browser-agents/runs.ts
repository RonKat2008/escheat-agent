import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { agentRuns } from "@/db/schema";
import { hasAnthropic } from "@/lib/env";
import type { DriveMode } from "./recorder";

export const FILING_AGENT = "filing_agent";
export const RECOVERY_AGENT = "recovery_agent";
export const CLAIM_AGENT = "claim_agent";

/** Agents run inside the Next server process (PGlite is single-process); this registry is that process's truth. */
const g = globalThis as unknown as { __escheatActiveAgentRuns?: Map<string, string> };
const active = (g.__escheatActiveAgentRuns ??= new Map<string, string>());

export class AgentAlreadyRunningError extends Error {
  constructor(
    public readonly key: string,
    public readonly runId: string,
  ) {
    super(`An agent run is already active for ${key} (run ${runId}).`);
    this.name = "AgentAlreadyRunningError";
  }
}

export function activeRunId(key: string): string | undefined {
  return active.get(key);
}

export function chooseMode(): DriveMode {
  return hasAnthropic() ? "stagehand" : "scripted";
}

export interface CreateRunArgs {
  agent: string;
  /** Registry key, e.g. `filing:<reportId>`. */
  key: string;
  subjectField: string;
  subjectId: string;
  companyId?: string;
  mode: DriveMode;
  modelLabel: string;
  input: Record<string, unknown>;
}

/** Marks DB rows left `running` by a previous process as failed, then inserts a fresh row and registers it. */
export async function createRun(db: Db, a: CreateRunArgs): Promise<string> {
  const existing = active.get(a.key);
  if (existing) throw new AgentAlreadyRunningError(a.key, existing);
  await db
    .update(agentRuns)
    .set({ status: "failed", error: "Orphaned: server restarted while this run was active.", finishedAt: new Date() })
    .where(
      and(
        eq(agentRuns.agent, a.agent),
        eq(agentRuns.status, "running"),
        sql`${agentRuns.input}->>${a.subjectField} = ${a.subjectId}`,
      ),
    );
  const [row] = await db
    .insert(agentRuns)
    .values({
      agent: a.agent,
      model: a.modelLabel,
      status: "running",
      companyId: a.companyId,
      input: { ...a.input, [a.subjectField]: a.subjectId, mode: a.mode },
      trace: [],
    })
    .returning({ id: agentRuns.id });
  const runId = row!.id;
  active.set(a.key, runId);
  return runId;
}

export function releaseRun(key: string): void {
  active.delete(key);
}
