/**
 * `pnpm seed:demo` — reset EVERYTHING to the demo starting state in one command. Idempotent.
 *   migrate -> wipe app rows (incl. outreach, reports, recoveries, agent runs, replica tables) ->
 *   seed SYNTHETIC company/ledger/clears/eval cases -> sync rules to DB -> stale detection ->
 *   reset the sim clock -> run the eval once (labeled heuristic when there is no API key).
 * Fails loudly if the demo invariants (47 items / $61,915.00; CA 21, TX 15, DE 11) do not hold.
 */
import { existsSync } from "node:fs";
import { closeDb, dbMode, getDb, migrate, PGLITE_DATA_DIR } from "../src/db/client";

// tsx does not load env files; env is read lazily by the app code.
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const usd = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
const EXPECTED = { items: 47, totalCents: 6_191_500, byState: { CA: 21, TX: 15, DE: 11 } } as const;

async function main() {
  const [{ DEMO_ANCHOR_DATE }, { buildBundle }, { seedDemo }, { syncRulesToDb }, clock, { detectStaleItems }, { runEval }] =
    await Promise.all([
      import("../src/lib/synthetic/model"),
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
  const problems: string[] = [];
  if (process.env.DEMO_ANCHOR_DATE === DEMO_ANCHOR_DATE) {
    if (count !== EXPECTED.items) problems.push(`expected ${EXPECTED.items} stale items, got ${count}`);
    if (total !== EXPECTED.totalCents) problems.push(`expected ${usd(EXPECTED.totalCents)}, got ${usd(total)}`);
    for (const [st, n] of Object.entries(EXPECTED.byState)) {
      if (stale.byState[st] !== n) problems.push(`expected ${st}=${n}, got ${stale.byState[st] ?? 0}`);
    }
  }

  const rule = "-".repeat(64);
  console.log(`\n${rule}\nDEMO STATE READY (SYNTHETIC data)\n${rule}`);
  console.log(`database      ${location}`);
  console.log(`demo date     ${today}  (sim clock reset to the anchor)`);
  console.log(`company       Northwind Fixtures, Inc.  payees=${counts.payees} ledger=${counts.ledgerItems} clears=${counts.bankClears}`);
  console.log(`rules         ${synced.map((s) => `${s.state}@${s.version}${s.verified ? "" : " (UNVERIFIED)"}`).join(", ")}`);
  console.log(`stale items   ${count}  total ${usd(total)}`);
  console.log(`by state      ${Object.entries(stale.byState).sort().map(([k, v]) => `${k} ${v}`).join(" · ")}`);
  console.log(`classifier    ${JSON.stringify(stale.methods)}${isLlmConfigured() ? "" : "  (heuristic: no ANTHROPIC_API_KEY)"}`);
  console.log(
    `eval          mode=${ev.mode}  cases=${counts.evalCases}  accuracy(all fields)=${(ev.overall.all_fields.accuracy * 100).toFixed(1)}%  failed=${ev.failed}`,
  );
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
