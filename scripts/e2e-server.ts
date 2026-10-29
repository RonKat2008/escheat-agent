/**
 * Starts one isolated e2e server: wipes + re-seeds its own PGlite directory (PGlite is single-process, so
 * every group gets its own), then runs `next dev` on the given port. Stops cleanly on SIGINT/SIGTERM.
 * Usage: tsx scripts/e2e-server.ts <demo|agents|ui>
 * Provider keys are scrubbed so the "not configured" states are deterministic; ESCHEAT_OFFLINE passes through.
 */
import { spawn, spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { createInterface } from "node:readline";
import { createDevLogFilter } from "../tests/e2e/dev-log-filter";
import { E2E_GROUPS, E2E_SECRETS, type E2EGroup } from "../tests/e2e/env";

const group = process.argv[2] as E2EGroup;
const cfg = E2E_GROUPS[group];
if (!cfg) {
  console.error(`Unknown e2e group "${group}". Expected one of: ${Object.keys(E2E_GROUPS).join(", ")}`);
  process.exit(2);
}

// E2E_DIR_SUFFIX lets two people/agents run the suites at once (also set E2E_PORT) without sharing data or build dirs.
const suffix = process.env.E2E_DIR_SUFFIX ?? "";
const pgDir = `.data/pglite-e2e-${group}${suffix}`;
const env: NodeJS.ProcessEnv = {
  ...process.env,
  ...E2E_SECRETS,
  PGLITE_DATA_DIR: pgDir,
  NEXT_DIST_DIR: `.next-e2e-${group}${suffix}`,
  APP_BASE_URL: `http://localhost:${cfg.port}`,
  DEMO_MODE: "1",
  DEMO_ANCHOR_DATE: "2026-11-01",
  AGENTS_ENABLED: "1",
  DATABASE_URL: "",
  ANTHROPIC_API_KEY: "",
  LOB_TEST_API_KEY: "",
  RESEND_API_KEY: "",
  VAPI_API_KEY: "",
  ALLOWED_TEST_PHONES: "",
  NEXT_TELEMETRY_DISABLED: "1",
};

rmSync(pgDir, { recursive: true, force: true });
if (!suffix) rmSync(`.data/agent-artifacts`, { recursive: true, force: true }); // a suffixed run must not wipe another run's artifacts
const step = (label: string, args: string[]) => {
  const r = spawnSync("node_modules/.bin/tsx", args, { env, stdio: "inherit" });
  if (r.status !== 0) {
    console.error(`[e2e-server:${group}] ${label} failed`);
    process.exit(r.status ?? 1);
  }
};
step("seed:demo", ["scripts/seed-demo.ts"]);
if (cfg.prep) step("prep", ["scripts/ui-b-prep.ts", "0"]);

const server = spawn("node_modules/.bin/next", ["dev", "-p", String(cfg.port)], { env, stdio: ["inherit", "pipe", "pipe"] });
// Collapse the known-benign replica 404 instant-validation stack into one line; all other output passes through.
// Both streams share one filter: Next splits the two halves of that block across stdout and stderr.
const filter = createDevLogFilter((l) => process.stdout.write(`${l}\n`));
for (const stream of [server.stdout, server.stderr]) {
  createInterface({ input: stream }).on("line", (l) => filter.line(l));
}
server.on("close", () => filter.end());
const stop = () => server.kill("SIGINT");
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
server.on("exit", (code) => process.exit(code ?? 0));
