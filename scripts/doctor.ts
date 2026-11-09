/**
 * `pnpm run doctor`: read-only health check. Env vars are reported by NAME only; nothing is written or printed as a value.
 */
import { existsSync } from "node:fs";
import { checkDbState, checkNodeVersion, checkPnpmVersion, formatChecks, formatEnvReport, type Check } from "../src/lib/setup/report";
import { currentEnv, ENV_LOCAL, isPortOpen, pnpmVersion, readDbState } from "./lib/project";

async function main() {
  if (existsSync(ENV_LOCAL)) process.loadEnvFile(ENV_LOCAL);
  const env = currentEnv();
  const checks: Check[] = [
    checkNodeVersion(process.version),
    checkPnpmVersion(pnpmVersion()),
    { ok: existsSync(ENV_LOCAL), label: ".env.local exists", hint: "Run `pnpm run setup`." },
  ];

  if (env.DATABASE_URL) {
    checks.push({ ok: true, label: "Database: Neon (DATABASE_URL set); migration/seed check skipped" });
  } else if (await isPortOpen(Number(process.env.PORT) || 3000)) {
    checks.push({ ok: true, label: "Dev server is running; database check skipped (PGlite is single-process). Stop `pnpm dev` to check it." });
  } else {
    checks.push(...checkDbState(await readDbState(env)));
  }

  console.log(`${formatChecks("Escheat Agent doctor", checks)}\n\n${formatEnvReport(env)}`);
  process.exit(checks.every((c) => c.ok) ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : "doctor failed");
  process.exit(1);
});
