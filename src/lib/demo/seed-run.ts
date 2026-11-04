import type { Db } from "@/db/client";
import { agentRuns } from "@/db/schema";
import { formatDemoUsd } from "./expected";

export interface SeedRunInput {
  rules: { state: string; version: string; verified: boolean }[];
  items: number;
  totalCents: number;
  byState: Record<string, number>;
}

/**
 * The one agent run a fresh seed writes, so Agent runs opens on a real first row (R6-11). It is the scripted filing
 * agent's readiness dry run: it records only what the seed actually did (loaded the rule files, counted the detected
 * stale items per state) and says plainly that no portal was opened, no report was generated and nothing was filed.
 * No model is called; the row is labelled scripted and is never billed.
 */
export async function recordSeedDryRun(db: Db, companyId: string, s: SeedRunInput): Promise<string> {
  const at = () => new Date().toISOString();
  const states = Object.keys(s.byState).sort();
  const trace = [
    { at: at(), kind: "info", message: "SCRIPTED (no model) - deterministic filing readiness check run by the demo seed" },
    ...s.rules.map((r) => ({
      at: at(),
      kind: "extract",
      message: `Loaded ${r.state} rules @ ${r.version}${r.verified ? "" : " (UNVERIFIED values present)"}`,
    })),
    ...states.map((st) => ({ at: at(), kind: "extract", message: `${st}: ${s.byState[st]} stale items detected` })),
    { at: at(), kind: "info", message: `Total ${s.items} items, ${formatDemoUsd(s.totalCents)}` },
    { at: at(), kind: "done", message: "Dry run only: no portal opened, no report generated, nothing filed. Filing needs a person's approval." },
  ];
  const [row] = await db
    .insert(agentRuns)
    .values({
      companyId,
      agent: "filing_agent",
      model: "scripted",
      status: "succeeded",
      input: { mode: "scripted", dryRun: true, states },
      output: { dryRun: true, items: s.items, totalCents: s.totalCents, byState: s.byState },
      trace,
      costUsdMicros: 0,
      finishedAt: new Date(),
    })
    .returning({ id: agentRuns.id });
  return row!.id;
}
