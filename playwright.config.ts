import { defineConfig, devices } from "playwright/test";
import { E2E_GROUPS, E2E_PORT_BASE, E2E_UI_STATE, type E2EGroup } from "./tests/e2e/env";
import { selectedGroups } from "./tests/e2e/select-groups";
import { firstRunSeen } from "./tests/e2e/first-run";

/**
 * Four isolated servers (each re-seeds its own PGlite dir via scripts/e2e-server.ts), because the specs
 * mutate shared state (filing a report, claiming a recovery, resolving items):
 *   demo   -> demo-path.spec.ts   (fresh demo start, the BRIEF's path end to end)
 *   agents -> agents.spec.ts
 *   ui     -> replica, ui-a, ui-b, chat, ui-states, ui-forecast specs (passcode-gated; global-setup signs in, see E2E_UI_PASSCODE)
 *   a11y   -> a11y.spec.ts (axe on every page) + a11y-keyboard.spec.ts
 *
 * E2E_PERF=1 swaps all of that for one production server (`next build` + `next start`, scripts/e2e-perf-server.ts)
 * and the "perf" project (ui-v3-perf.spec.ts budgets), because `next dev` bundles say nothing about shipped JS:
 *   E2E_PERF=1 pnpm exec playwright test ui-v3-perf --project perf
 */
const groups = Object.keys(E2E_GROUPS) as E2EGroup[];
const url = (g: E2EGroup) => `http://localhost:${E2E_GROUPS[g].port}`;
const match: Record<E2EGroup, RegExp> = {
  demo: /demo-path\.spec\.ts$/,
  // Anchored to the file name so ui-v3-agents.spec.ts (ui project) does not also run here. agents-*.spec.ts too
  // (agents-filing-under-load.spec.ts, R9-01).
  agents: /(^|[\\/])agents(-[\w-]+)?\.spec\.ts$/,
  ui: /(replica|ui-[\w-]+|chat)\.spec\.ts$/,
  a11y: /a11y(-keyboard)?\.spec\.ts$/,
};

// Only boot the dev servers the selected projects need (each `next dev` costs ~750 MB of .next-e2e-* cache and a full
// CPU; `--project ui` used to start all four). See tests/e2e/select-groups.ts. global-setup reads E2E_ACTIVE_GROUPS.
const activeGroups = selectedGroups(process.argv, process.env.E2E_PROJECTS, groups);
process.env.E2E_ACTIVE_GROUPS = activeGroups.join(",");

const PERF = process.env.E2E_PERF === "1";
const PERF_PORT = E2E_PORT_BASE + 5;

const devServers = {
  globalSetup: "./tests/e2e/global-setup.ts",
  projects: groups.map((g) => ({
    name: g,
    testMatch: match[g],
    // Every project starts with the first-run welcome already answered (tests/e2e/first-run.ts); the ui project gets it
    // through the signed-in state global-setup saves.
    use: { ...devices["Desktop Chrome"], baseURL: url(g), storageState: g === "ui" ? E2E_UI_STATE : { cookies: [], origins: [firstRunSeen(url(g))] } },
  })),
  webServer: activeGroups.map((g) => ({
    command: `node_modules/.bin/tsx scripts/e2e-server.ts ${g}`,
    url: `${url(g)}/replica/tx-search`,
    reuseExistingServer: false,
    timeout: 300_000,
    gracefulShutdown: { signal: "SIGINT" as const, timeout: 15_000 },
    stdout: "pipe" as const,
  })),
};

const perfServer = {
  projects: [{ name: "perf", testMatch: /ui-v3-perf\.spec\.ts$/, use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${PERF_PORT}` } }],
  webServer: [
    {
      command: `node_modules/.bin/tsx scripts/e2e-perf-server.ts ${PERF_PORT}`,
      url: `http://localhost:${PERF_PORT}/replica/tx-search`,
      reuseExistingServer: false,
      // Includes a full `next build`.
      timeout: 900_000,
      gracefulShutdown: { signal: "SIGINT" as const, timeout: 15_000 },
      stdout: "pipe" as const,
    },
  ],
};

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  // CI runners compile dev routes far slower than a laptop; give assertions more room there.
  expect: { timeout: process.env.CI ? 15_000 : 5_000 },
  use: { trace: "retain-on-failure" },
  ...(PERF ? perfServer : devServers),
});
