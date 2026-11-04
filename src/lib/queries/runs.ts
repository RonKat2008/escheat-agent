import { and, count, desc, eq, isNull, not, or, sql, type SQL } from "drizzle-orm";
import type { Db } from "@/db/client";
import { agentRuns, evalCases, evalResults, evalRuns } from "@/db/schema";

/**
 * "replayed" and "heuristic" are derived statuses of a run stored as `cancelled` because an offline replay had no
 * recorded answer (no model call, nothing failed). A classifier run is the seed's deterministic "heuristic" baseline
 * (R7-10: nothing was replayed); any other agent is "replayed". The chip and the row use the same word.
 */
export const RUN_STATUS_FILTERS = ["running", "succeeded", "failed", "cancelled", "replayed", "heuristic"] as const;
export type RunStatusFilter = (typeof RUN_STATUS_FILTERS)[number];

export interface AgentRunFilters {
  agent?: string;
  status?: RunStatusFilter;
  /** Default true. False hides skipped offline replays unless `status` is "replayed". */
  includeReplays?: boolean;
}

const visibleToCompany = (companyId: string) => or(eq(agentRuns.companyId, companyId), isNull(agentRuns.companyId));
const isSkippedReplaySql = () => and(eq(agentRuns.status, "cancelled"), sql`coalesce(${agentRuns.input}->>'mode' = 'replay', false)`);

const isHeuristicSql = () =>
  and(isSkippedReplaySql(), sql`replace(${agentRuns.agent}, '-', '_') in ('classifier', 'classifier_escalation')`);

function runWhere(companyId: string, f: AgentRunFilters) {
  const conds: Array<SQL | undefined> = [visibleToCompany(companyId)];
  if (f.agent) conds.push(eq(agentRuns.agent, f.agent));
  if (f.status === "replayed") conds.push(isSkippedReplaySql(), not(isHeuristicSql()!));
  else if (f.status === "heuristic") conds.push(isHeuristicSql());
  else {
    if (f.status === "cancelled") conds.push(eq(agentRuns.status, "cancelled"));
    else if (f.status) conds.push(eq(agentRuns.status, f.status));
    if (f.status === "cancelled" || f.includeReplays === false) conds.push(not(isSkippedReplaySql()!));
  }
  return and(...conds);
}

/** Newest first. Every filter runs in SQL, so history older than any window is reachable by offset. */
export async function listAgentRuns(db: Db, companyId: string, opts: AgentRunFilters & { limit?: number; offset?: number } = {}) {
  return db
    .select()
    .from(agentRuns)
    .where(runWhere(companyId, opts))
    .orderBy(desc(agentRuns.startedAt), desc(agentRuns.id))
    .limit(opts.limit ?? 50)
    .offset(opts.offset ?? 0);
}

export async function countAgentRuns(db: Db, companyId: string, filters: AgentRunFilters = {}): Promise<number> {
  const [row] = await db.select({ n: count() }).from(agentRuns).where(runWhere(companyId, filters));
  return Number(row?.n ?? 0);
}

/** Every agent that has at least one run (hidden replays included), so the filter chips never disappear. */
export async function listAgentRunAgents(db: Db, companyId: string): Promise<string[]> {
  const rows = await db.selectDistinct({ agent: agentRuns.agent }).from(agentRuns).where(visibleToCompany(companyId)).orderBy(agentRuns.agent);
  return rows.map((r) => r.agent);
}

/** Run counts per status chip (within one agent when given), over the whole table. */
export async function countAgentRunsByStatus(db: Db, companyId: string, agent?: string): Promise<Record<RunStatusFilter, number>> {
  const rows = await db
    .select({
      status: agentRuns.status,
      agent: agentRuns.agent,
      replay: sql<boolean>`coalesce(${agentRuns.input}->>'mode' = 'replay', false)`,
      n: count(),
    })
    .from(agentRuns)
    .where(and(visibleToCompany(companyId), agent ? eq(agentRuns.agent, agent) : undefined))
    .groupBy(agentRuns.status, agentRuns.agent, sql`coalesce(${agentRuns.input}->>'mode' = 'replay', false)`);
  const out: Record<RunStatusFilter, number> = { running: 0, succeeded: 0, failed: 0, cancelled: 0, replayed: 0, heuristic: 0 };
  for (const r of rows) {
    const heuristic = /^classifier(?:[-_]escalation)?$/.test(r.agent);
    out[r.status === "cancelled" && r.replay ? (heuristic ? "heuristic" : "replayed") : r.status] += Number(r.n);
  }
  return out;
}

export async function getAgentRun(db: Db, id: string) {
  const [row] = await db.select().from(agentRuns).where(eq(agentRuns.id, id));
  return row ?? null;
}

/** Company-scoped lookup, same visibility as listAgentRuns (the company's runs plus unowned system runs). */
export async function getAgentRunForCompany(db: Db, companyId: string, id: string) {
  const [row] = await db
    .select()
    .from(agentRuns)
    .where(and(eq(agentRuns.id, id), or(eq(agentRuns.companyId, companyId), isNull(agentRuns.companyId))));
  return row ?? null;
}

export async function getLatestEvalRun(db: Db) {
  const [run] = await db.select().from(evalRuns).orderBy(desc(evalRuns.runAt)).limit(1);
  if (!run) return null;
  const results = await db
    .select({
      id: evalResults.id,
      caseId: evalResults.caseId,
      pass: evalResults.pass,
      errorKind: evalResults.errorKind,
      actual: evalResults.actual,
      slice: evalCases.slice,
      itemSnapshot: evalCases.itemSnapshot,
      expected: evalCases.expected,
    })
    .from(evalResults)
    .innerJoin(evalCases, eq(evalCases.id, evalResults.caseId))
    .where(eq(evalResults.runId, run.id));
  return { run, results };
}
