import { and, desc, eq, or, isNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import { agentRuns, evalCases, evalResults, evalRuns } from "@/db/schema";

export async function listAgentRuns(db: Db, companyId: string, opts: { limit?: number; offset?: number; agent?: string } = {}) {
  const rows = await db
    .select()
    .from(agentRuns)
    .where(or(eq(agentRuns.companyId, companyId), isNull(agentRuns.companyId)))
    .orderBy(desc(agentRuns.startedAt))
    .limit(opts.limit ?? 50)
    .offset(opts.offset ?? 0);
  return opts.agent ? rows.filter((r) => r.agent === opts.agent) : rows;
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
