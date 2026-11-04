/**
 * Data for "Watch it work" (/theater): one REAL stored agent run, shaped into ordered steps. Rules-engine steps are
 * enriched from the versioned rule files (rules/*.json) with their source URLs and verified flag, never from a model.
 * Read-only.
 */
import type { Db } from "@/db/client";
import { pinRules, tryLoadRules, type LoadedRules } from "@/lib/rules/load";
import { listRuleValues } from "@/lib/rules/values";
import { traceToSteps, type RuleRef, type TheaterStep } from "@/lib/theater/steps";
import { getAgentRunForCompany, listAgentRuns } from "./runs";

export interface TheaterRun {
  id: string;
  agent: string;
  model: string | null;
  status: string;
  /** True when no model was called (scripted driver or offline replay). */
  noModel: boolean;
  /** Answered from a recorded cassette (ESCHEAT_OFFLINE): the model's recorded output, no new call, not billed. */
  replay: boolean;
  startedAt: string;
  finishedAt: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  /** Raw trace length; equals steps.length by construction. */
  traceLength: number;
  steps: TheaterStep[];
}

export interface TheaterRunSummary {
  id: string;
  agent: string;
  status: string;
  startedAt: string;
}

const SOURCE_URLS_MAX = 3;

function loadRuleFile(state: string, version: string | null): LoadedRules | null {
  if (version) {
    try {
      return pinRules(state, version);
    } catch {
      /* that version is not on disk any more: fall back to the current file and show its version */
    }
  }
  try {
    return tryLoadRules(state);
  } catch {
    return null; // an unreadable or unknown rule file means no reference, never a guessed one
  }
}

function ruleRefFor(state: string, version: string | null, cache: Map<string, RuleRef | null>): RuleRef | null {
  const key = `${state}@${version ?? ""}`;
  if (cache.has(key)) return cache.get(key)!;
  const loaded = loadRuleFile(state, version);
  let ref: RuleRef | null = null;
  if (loaded) {
    const values = listRuleValues(loaded.file);
    const urls = [...new Set(values.flatMap((v) => v.rv.sources.map((s) => s.url)).filter((u) => /^https?:\/\//.test(u)))];
    const unverifiedCount = values.filter((v) => !v.rv.verified).length;
    ref = { state, version: loaded.file.version, verified: values.length > 0 && unverifiedCount === 0, unverifiedCount, sourceUrls: urls.slice(0, SOURCE_URLS_MAX) };
  }
  cache.set(key, ref);
  return ref;
}

/** Attaches the rule file each rules-engine step read. Pure apart from reading rules/ from disk. */
export function withRuleRefs(steps: readonly TheaterStep[]): TheaterStep[] {
  const cache = new Map<string, RuleRef | null>();
  return steps.map((s) => {
    if (s.stage !== "rules" || !s.ruleState) return s;
    const ruleRef = ruleRefFor(s.ruleState, s.ruleVersion, cache);
    return ruleRef ? { ...s, ruleRef, unverified: s.unverified || !ruleRef.verified } : s;
  });
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export async function getTheaterRun(db: Db, companyId: string, id: string): Promise<TheaterRun | null> {
  const run = await getAgentRunForCompany(db, companyId, id);
  if (!run) return null;
  const trace = Array.isArray(run.trace) ? run.trace : [];
  const mode = isObj(run.input) ? run.input.mode : null;
  return {
    id: run.id,
    agent: run.agent,
    model: run.model,
    status: run.status,
    replay: mode === "replay",
    noModel: mode === "scripted" || mode === "replay" || (run.model ?? "").startsWith("scripted"),
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
    inputTokens: run.inputTokens,
    outputTokens: run.outputTokens,
    traceLength: trace.length,
    steps: withRuleRefs(traceToSteps({ ...run, trace })),
  };
}

/** Recent runs for the picker, newest first. Skipped offline replays (nothing recorded) are left out. */
export async function listTheaterRuns(db: Db, companyId: string, limit = 12): Promise<TheaterRunSummary[]> {
  const rows = await listAgentRuns(db, companyId, { includeReplays: false, limit });
  return rows.map((r) => ({ id: r.id, agent: r.agent, status: r.status, startedAt: r.startedAt.toISOString() }));
}
