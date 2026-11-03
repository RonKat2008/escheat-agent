/**
 * Production server for the perf budget spec (tests/e2e/ui-v3-perf.spec.ts, Playwright project "perf", E2E_PERF=1).
 * `next dev` ships unminified, unsplit JS, so bundle budgets only mean something against `next build` + `next start`.
 * Seeds its own PGlite dir, builds into its own dist dir, then serves. Passcode-gated like production (E2E_UI_PASSCODE), offline provider keys.
 * Usage: tsx scripts/e2e-perf-server.ts <port>
 *   E2E_PERF_PREBUILT=<distDir> serves an existing build (e.g. a baseline) instead of building; `--build-only` builds
 *   and exits (`--build-only <port>`, pair it with E2E_PERF_DIST=<distDir>).
 */
import { spawn, spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { E2E_SECRETS, E2E_UI_PASSCODE } from "../tests/e2e/env";

const buildOnly = process.argv[2] === "--build-only";
const port = process.argv[buildOnly ? 3 : 2];
if (!port || !/^\d+$/.test(port)) {
  console.error("Usage: tsx scripts/e2e-perf-server.ts [--build-only] <port>");
  process.exit(2);
}

const suffix = process.env.E2E_DIR_SUFFIX ?? "";
const pgDir = `.data/pglite-e2e-perf${suffix}`;
const env: NodeJS.ProcessEnv = {
  ...process.env,
  ...E2E_SECRETS,
  NODE_ENV: "production",
  PGLITE_DATA_DIR: pgDir,
  NEXT_DIST_DIR: process.env.E2E_PERF_PREBUILT || process.env.E2E_PERF_DIST || `.next-e2e-perf${suffix}`,
  APP_BASE_URL: `http://localhost:${port}`,
  DEMO_MODE: "1",
  DEMO_ANCHOR_DATE: "2026-11-01",
  AGENTS_ENABLED: "1",
  DATABASE_URL: "",
  ANTHROPIC_API_KEY: "",
  LOB_TEST_API_KEY: "",
  AGENTMAIL_API_KEY: "",
  VAPI_API_KEY: "",
  ALLOWED_TEST_PHONES: "",
  QBO_CLIENT_ID: "",
  QBO_CLIENT_SECRET: "",
  PLAID_CLIENT_ID: "",
  PLAID_SECRET: "",
  NEXT_TELEMETRY_DISABLED: "1",
  // Production fails closed without a passcode; the perf spec signs in through /login like global-setup does.
  APP_PASSCODE: E2E_UI_PASSCODE,
};

const run = (label: string, cmd: string, args: string[]) => {
  const r = spawnSync(cmd, args, { env, stdio: "inherit" });
  if (r.status !== 0) {
    console.error(`[e2e-perf-server] ${label} failed`);
    process.exit(r.status ?? 1);
  }
};

rmSync(pgDir, { recursive: true, force: true });
run("seed:demo", "node_modules/.bin/tsx", ["scripts/seed-demo.ts"]);
if (!process.env.E2E_PERF_PREBUILT) run("next build", "node_modules/.bin/next", ["build"]);
if (buildOnly) process.exit(0);

const server = spawn("node_modules/.bin/next", ["start", "-p", port], { env, stdio: "inherit" });
const stop = () => server.kill("SIGINT");
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
server.on("exit", (code) => process.exit(code ?? 0));
