/**
 * `pnpm eval` — run the classifier over fixtures/eval/cases.*.json and score it.
 *
 * is_stale: computed with src/lib/recon isStale at the anchor date (DEMO_ANCHOR_DATE, else 2026-11-01)
 * and STALE_THRESHOLD_DAYS, and only for items with no cleared_date (a cleared item is not outstanding).
 * Holder: eval cases carry no holder, so the demo holder's state of incorporation (DE) is assumed;
 * override with EVAL_HOLDER_STATE.
 * Method honesty: with no ANTHROPIC_API_KEY (and not offline) the classifier uses the labeled
 * deterministic heuristic; the report says so prominently and stores it in eval_runs.metrics.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { ORCHESTRATOR_MODEL, WORKER_MODEL } from "@config/models";
import { closeDb, getDb, migrate } from "@/db/client";
import { evalCases, evalResults, evalRuns } from "@/db/schema";
import { classifyBatch, type Classification } from "@/lib/agents/classifier";
import { scoreEval, EVAL_FIELDS, type EvalActual, type EvalScore } from "@/lib/agents/eval-score";
import { classifierItemSchema } from "@/lib/agents/types";
import { demoAnchorDate, getEnv, isOffline, staleThresholdDays } from "@/lib/env";
import { isLlmConfigured } from "@/lib/llm/client";
import { isStale } from "@/lib/recon/reconcile";

const DEFAULT_ANCHOR = "2026-11-01";

const caseSchema = z.object({
  id: z.string(),
  slice: z.enum(["generated", "adversarial"]),
  item: classifierItemSchema,
  expected: z.object({
    property_type: z.string(),
    owner_state: z.string(),
    owner_state_basis: z.string(),
    is_stale: z.boolean(),
  }),
});
type EvalCase = z.infer<typeof caseSchema>;

function loadCases(dir: string): EvalCase[] {
  const files = readdirSync(dir).filter((f) => /^cases\..*\.json$/.test(f)).sort();
  if (files.length === 0) throw new Error(`No fixtures/eval/cases.*.json found in ${dir} (lane L1 writes them).`);
  return files.flatMap((f) => {
    const raw: unknown = JSON.parse(readFileSync(path.join(dir, f), "utf8"));
    const list = Array.isArray(raw) ? raw : (raw as { cases?: unknown }).cases;
    // The generated fixtures label `kind` with ledger property types; the classifier input takes check|credit|unapplied_cash.
    const KIND: Record<string, string> = { vendor_check: "check", payroll_check: "check", customer_credit: "credit" };
    const normalized = (list as { item?: { kind?: string } }[]).map((c) =>
      c?.item?.kind && KIND[c.item.kind] ? { ...c, item: { ...c.item, kind: KIND[c.item.kind] } } : c,
    );
    return z.array(caseSchema).parse(normalized);
  });
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

function printScore(score: EvalScore): void {
  const row = (label: string, s: EvalScore["overall"]) =>
    console.log(
      `${label.padEnd(14)} ${EVAL_FIELDS.map((f) => `${f}=${pct(s[f].accuracy)} (${s[f].correct}/${s[f].total})`).join("  ")}  all=${pct(s.all_fields.accuracy)}`,
    );
  for (const [slice, s] of Object.entries(score.bySlice)) row(slice, s);
  row("OVERALL", score.overall);
}

async function main(): Promise<void> {
  const env = getEnv();
  const anchor = demoAnchorDate(env) ?? DEFAULT_ANCHOR;
  const threshold = staleThresholdDays(env);
  const holderState = process.env.EVAL_HOLDER_STATE?.trim() || "DE";
  const cases = loadCases(process.env.EVAL_CASES_DIR ?? path.join(process.cwd(), "fixtures", "eval"));

  const mode = isOffline(env) ? "replay (ESCHEAT_OFFLINE: cassettes only)" : isLlmConfigured() ? "model" : "heuristic";
  console.log("=".repeat(78));
  if (mode === "heuristic") {
    console.log("CLASSIFIER METHOD: HEURISTIC (no ANTHROPIC_API_KEY). These numbers measure the deterministic");
    console.log("keyword baseline, NOT the model. Do not present them as model accuracy.");
  } else {
    console.log(`CLASSIFIER METHOD: ${mode.toUpperCase()}  worker=${WORKER_MODEL} orchestrator=${ORCHESTRATOR_MODEL}`);
  }
  console.log(`cases=${cases.length} anchor=${anchor} stale_threshold_days=${threshold} holder_state=${holderState}`);
  console.log("=".repeat(78));

  const actuals = new Map<string, EvalActual>();
  const classifications = new Map<string, Classification>();
  const failures = new Map<string, string>();
  const ctx = { holder: { stateOfIncorporation: holderState } };

  // classifyBatch fails the whole batch on one error, so run per-case to record per-case failures.
  let next = 0;
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (next < cases.length) {
        const c = cases[next++];
        if (!c) continue;
        try {
          const [cls] = await classifyBatch([c.item], { ctx: { ...ctx, subjectId: c.id } });
          if (!cls) throw new Error("no classification returned");
          classifications.set(c.id, cls);
          actuals.set(c.id, {
            property_type: cls.property_type,
            owner_state: cls.owner_state,
            owner_state_basis: cls.owner_state_basis,
            is_stale: !c.item.cleared_date && isStale({ issueDate: c.item.issue_date }, anchor, threshold),
            method: cls.method,
          });
        } catch (err) {
          failures.set(c.id, err instanceof Error ? `${err.name}: ${err.message}` : String(err));
          actuals.set(c.id, null);
        }
      }
    }),
  );

  const score = scoreEval(cases, actuals);
  const methodCounts: Record<string, number> = {};
  for (const cls of classifications.values()) methodCounts[cls.method] = (methodCounts[cls.method] ?? 0) + 1;
  const reviewCount = [...classifications.values()].filter((c) => c.needs_review).length;

  printScore(score);
  console.log(`methods used: ${JSON.stringify(methodCounts)}  needs_review=${reviewCount}  failed=${failures.size}`);
  console.log(`\nERRORS (${score.errors.length}):`);
  for (const e of score.errors) {
    const why = failures.get(e.id);
    console.log(`  ${e.id} [${e.slice}] ${e.field}: expected=${JSON.stringify(e.expected)} actual=${JSON.stringify(e.actual)}${why ? ` (${why})` : ""}`);
  }

  await migrate();
  const db = await getDb();
  const metrics = { mode, anchor, threshold, holderState, methodCounts, failed: failures.size, overall: score.overall, bySlice: score.bySlice };
  const [run] = await db
    .insert(evalRuns)
    .values({ workerModel: WORKER_MODEL, orchestratorModel: ORCHESTRATOR_MODEL, metrics })
    .returning({ id: evalRuns.id });
  if (!run) throw new Error("failed to insert eval_runs row");

  const existing = await db.select().from(evalCases);
  const idByCaseId = new Map(existing.map((r) => [String(r.itemSnapshot.caseId), r.id]));
  for (const c of cases) {
    if (idByCaseId.has(c.id)) continue;
    const [row] = await db
      .insert(evalCases)
      .values({ slice: c.slice, itemSnapshot: { caseId: c.id, ...c.item }, expected: c.expected })
      .returning({ id: evalCases.id });
    if (row) idByCaseId.set(c.id, row.id);
  }
  const rows = cases.flatMap((c) => {
    const caseUuid = idByCaseId.get(c.id);
    if (!caseUuid) return [];
    const actual = actuals.get(c.id);
    return [
      {
        runId: run.id,
        caseId: caseUuid,
        actual: actual ? { ...actual, classification: classifications.get(c.id) } : null,
        pass: score.passByCase[c.id] ?? false,
        errorKind: failures.has(c.id) ? "classifier_error" : null,
      },
    ];
  });
  for (let i = 0; i < rows.length; i += 100) await db.insert(evalResults).values(rows.slice(i, i + 100));
  console.log(`\nwrote eval_runs ${run.id} with ${rows.length} eval_results`);
  await closeDb();
}

main().catch(async (err) => {
  console.error(err);
  await closeDb().catch(() => undefined);
  process.exit(1);
});
