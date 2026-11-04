/**
 * `pnpm seed:demo` — reset EVERYTHING to the demo starting state in one command. Idempotent.
 *   migrate -> wipe app rows (incl. outreach, reports, recoveries, agent runs, replica tables) ->
 *   seed SYNTHETIC company/ledger/clears/eval cases -> sync rules to DB -> stale detection ->
 *   reset the sim clock -> run the eval once (heuristic/offline unless SEED_LIVE=1 is set).
 * Fails loudly if the demo invariants (47 items / $61,915.00; CA 21, TX 15, DE 11) do not hold.
 */
import { existsSync } from "node:fs";
import { closeDb, dbMode, getDb, migrate, PGLITE_DATA_DIR } from "../src/db/client";

// tsx does not load env files; env is read lazily by the app code.
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

// R4-11: the seed is heuristic/offline by default, even when .env.local holds a key (the live classifier + 200-case
// eval take minutes and spend money, and can drift from the recorded chat cassettes). Opt in with SEED_LIVE=1.
const SEED_LIVE = process.env.SEED_LIVE === "1";
if (!SEED_LIVE && process.env.ANTHROPIC_API_KEY) {
  process.env.ANTHROPIC_API_KEY = "";
  console.log("seed: heuristic/offline classifier (a key was found but SEED_LIVE=1 is not set; set it to classify and eval live).");
} else if (SEED_LIVE) {
  console.log("seed: SEED_LIVE=1, using the live classifier and eval (slow; spends API credits).");
}
const startedAt = Date.now();


async function main() {
  const [{ DEMO_ANCHOR_DATE }, { demoInvariantProblems, formatDemoUsd: usd }, { recordSeedDryRun }, { buildBundle }, { seedDemo }, { syncRulesToDb }, clock, { detectStaleItems }, { runEval }] =
    await Promise.all([
      import("../src/lib/synthetic/model"),
      import("../src/lib/demo/expected"),
      import("../src/lib/demo/seed-run"),
      import("../src/lib/synthetic/build"),
      import("../src/lib/synthetic/seed"),
      import("../src/lib/rules/load"),
      import("../src/lib/clock"),
      import("../src/lib/pipeline/detect"),
      import("../src/lib/agents/eval-run"),
    ]);
  const { resolveCompanyId } = await import("../src/lib/pipeline/company");
  const { isLlmConfigured } = await import("../src/lib/llm/client");

  // The seeded numbers are defined at the demo anchor date; pin it for this process when .env.local does not.
  process.env.DEMO_ANCHOR_DATE ||= DEMO_ANCHOR_DATE;

  const mode = await migrate();
  const location = dbMode() === "pglite" ? `${mode}: ${process.env.PGLITE_DATA_DIR?.trim() || PGLITE_DATA_DIR}` : mode;
  console.log(`Resetting demo state (${location})...`);
  const db = await getDb();

  const bundle = buildBundle();
  const counts = await seedDemo(db, bundle.dataset, [...bundle.generatedCases, ...bundle.adversarialCases]);
  const synced = await syncRulesToDb(db);
  const companyId = await resolveCompanyId(db);
  if (!companyId) throw new Error("seed produced no company");
  await clock.resetClock(db, companyId);
  const today = await clock.now(db, companyId);
  const stale = await detectStaleItems(db, companyId);

  console.log("Running the eval once (this populates /eval)...");
  const ev = await runEval();

  const total = stale.totalCents;
  const count = stale.inserted + stale.updated;
  await recordSeedDryRun(db, companyId, { rules: synced, items: count, totalCents: total, byState: stale.byState });
  const problems = process.env.DEMO_ANCHOR_DATE === DEMO_ANCHOR_DATE ? demoInvariantProblems({ items: count, totalCents: total, byState: stale.byState }) : [];

  const rule = "-".repeat(64);
  console.log(`\n${rule}\nDEMO STATE READY (SYNTHETIC data)\n${rule}`);
  console.log(`database      ${location}`);
  console.log(`demo date     ${today}  (sim clock reset to the anchor)`);
  console.log(`company       Northwind Fixtures, Inc.  payees=${counts.payees} ledger=${counts.ledgerItems} clears=${counts.bankClears}`);
  console.log(`rules         ${synced.map((s) => `${s.state}@${s.version}${s.verified ? "" : " (UNVERIFIED)"}`).join(", ")}`);
  console.log(`stale items   ${count}  total ${usd(total)}`);
  console.log(`by state      ${Object.entries(stale.byState).sort().map(([k, v]) => `${k} ${v}`).join(" · ")}`);
  console.log(`classifier    ${JSON.stringify(stale.methods)}${isLlmConfigured() ? "" : "  (heuristic: no live key in use; SEED_LIVE=1 to classify live)"}`);
  console.log(
    `eval          mode=${ev.mode}  cases=${counts.evalCases}  accuracy(all fields)=${(ev.overall.all_fields.accuracy * 100).toFixed(1)}%  failed=${ev.failed}`,
  );
  console.log(`method        ${SEED_LIVE ? "live (SEED_LIVE=1)" : "heuristic/offline (default)"}  elapsed ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  console.log("cleared       outreach, approvals, reports, recoveries, agent runs, replica submissions/claims");
  console.log(rule);
  if (problems.length) throw new Error(`Demo invariants broken: ${problems.join("; ")}`);
}

main()
  .then(() => closeDb())
  .catch(async (err) => {
    console.error(err);
    await closeDb().catch(() => undefined);
    process.exit(1);
  });
