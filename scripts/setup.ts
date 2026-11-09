/**
 * `pnpm run setup`: first-time setup in one command, safe to rerun. No keys needed.
 *   check Node/pnpm -> create .env.local if missing -> fill EMPTY local secrets -> migrate -> seed -> checklist.
 * Never prints or overwrites existing env values.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { ensureEnvFile, fillEmptySecrets } from "../src/lib/setup/env-file";
import { checkNodeVersion, checkPnpmVersion, formatChecks, formatEnvReport, formatQuickStart } from "../src/lib/setup/report";
import { currentEnv, ENV_EXAMPLE, ENV_LOCAL, pnpmVersion, runPnpmScript } from "./lib/project";

function fail(message: string): never {
  console.error(`\nSetup stopped: ${message}`);
  process.exit(1);
}

const prereqs = [checkNodeVersion(process.version), checkPnpmVersion(pnpmVersion())];
console.log(formatChecks("Escheat Agent setup", prereqs));
if (prereqs.some((c) => !c.ok)) fail("fix the items above and rerun.");

const created = ensureEnvFile(ENV_EXAMPLE, ENV_LOCAL);
if (created === "no-example") fail(".env.example is missing.");
console.log(created === "created" ? "  [ok]   Created .env.local from .env.example (all keys optional)" : "  [ok]   .env.local already exists (left as is)");

const { text, filled } = fillEmptySecrets(readFileSync(ENV_LOCAL, "utf8"));
if (filled.length > 0) writeFileSync(ENV_LOCAL, text, { mode: 0o600 });
console.log(filled.length > 0 ? `  [ok]   Generated local-only secrets: ${filled.join(", ")}` : "  [ok]   Local secrets already set");

console.log("\nMigrating the local database...");
if (runPnpmScript("db:migrate") !== 0) fail("migrations failed (is `pnpm dev` running? stop it and rerun).");
console.log("\nSeeding the synthetic demo company...");
if (runPnpmScript("seed:demo") !== 0) fail("seeding failed (see the output above).");

console.log(`\n${formatEnvReport(currentEnv())}\n\n${formatQuickStart()}`);
