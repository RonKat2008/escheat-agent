/**
 * `pnpm smoke:live` - one command to prove each external service works with real credentials.
 *
 *   pnpm smoke:live [--dial [--dial-to +1415...]] [--json out.json] [--only anthropic,lob]
 *
 * Each service prints PASS / FAIL / SKIPPED (with the env vars that are missing). Exit code is non-zero iff a
 * configured service FAILS. SKIPPED never fails the run.
 *
 * SAFETY CHOICES (nothing here weakens a guard):
 *  - Lob / Resend / Vapi-dial go through the REAL send path (approveOutreach -> sendOutreach -> withApproval).
 *    That path requires an in-app approval of the exact payload (HARD RULE 5). The approval is created
 *    programmatically by approveOutreach with approver "smoke-live", for a SYNTHETIC outreach row inserted by this
 *    script in a throwaway database. We chose this over calling the SDKs directly because the allowlist, Lob test_ key
 *    guard, payload-hash approval and assistant transfer-tool checks all stay in force and are exercised for real.
 *  - Lob: refuses unless LOB_TEST_API_KEY starts with test_. Resend: only to the FIRST address in
 *    ALLOWED_TEST_RECIPIENTS. Vapi: GET phone number (and the assistant, verifying no transfer tools, if VAPI_ASSISTANT_ID is set); dials
 *    only with --dial, using the inline assistant, to the first ALLOWED_TEST_PHONES entry (or --dial-to, which must still be allowlisted).
 *  - Stagehand: replica-only (guardedGoto + fenced browser); SKIPPED unless the local replica answers.
 *  - ESCHEAT_OFFLINE=1 makes the sending/model checks SKIPPED (they would replay or fake, not prove anything live).
 *  - Database: always a throwaway PGlite directory. DATABASE_URL is dropped for this process and a PGLITE_DATA_DIR from
 *    .env.local is ignored, so the app's data (and a running dev server's single-process PGlite) is never touched.
 *    Pass PGLITE_DATA_DIR=<dir> on the command line to choose the scratch directory; default is a fresh temp dir.
 */
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { closeDb, getDb, migrate } from "../src/db/client";
import { parseEnv } from "../src/lib/env";
import { buildChecks } from "../src/lib/smoke/checks";
import { ArgError, exitCodeFor, formatTable, parseArgs, runChecks, toJson } from "../src/lib/smoke/run";

// Capture the caller's explicit scratch dir BEFORE .env.local can inject the app's own.
const explicitPgliteDir = process.env.PGLITE_DATA_DIR?.trim();
if (existsSync(".env.local")) process.loadEnvFile(".env.local");
delete process.env.DATABASE_URL; // synthetic smoke rows must never reach Neon
process.env.PGLITE_DATA_DIR = explicitPgliteDir || mkdtempSync(path.join(tmpdir(), "escheat-smoke-live-"));

async function main(): Promise<number> {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    if (e instanceof ArgError) {
      console.error(`${e.message}\nusage: pnpm smoke:live [--dial [--dial-to <e164>]] [--json <path>] [--only <service,...>]`);
      return 2;
    }
    throw e;
  }
  const raw = { ...process.env };
  let dbReady: Promise<Awaited<ReturnType<typeof getDb>>> | undefined;
  const results = await runChecks(buildChecks(), {
    env: parseEnv(raw),
    raw,
    args,
    fetch,
    getDb: () => (dbReady ??= migrate().then(() => getDb())),
  });
  console.log(`\nescheat-agent smoke:live (scratch PGlite: ${process.env.PGLITE_DATA_DIR})\n`);
  console.log(formatTable(results));
  if (args.json) {
    writeFileSync(args.json, toJson(results, new Date()));
    console.log(`\nJSON written to ${args.json}`);
  }
  return exitCodeFor(results);
}

main()
  .then(async (code) => {
    await closeDb().catch(() => undefined);
    process.exit(code);
  })
  .catch(async (e) => {
    console.error(e instanceof Error ? (e.stack ?? e.message) : e);
    await closeDb().catch(() => undefined);
    process.exit(1);
  });
