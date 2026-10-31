import { defineConfig, devices } from "playwright/test";
import { E2E_GROUPS, E2E_UI_STATE, type E2EGroup } from "./tests/e2e/env";

/**
 * Four isolated servers (each re-seeds its own PGlite dir via scripts/e2e-server.ts), because the specs
 * mutate shared state (filing a report, claiming a recovery, resolving items):
 *   demo   -> demo-path.spec.ts   (fresh demo start, the BRIEF's path end to end)
 *   agents -> agents.spec.ts
 *   ui     -> replica, ui-a, ui-b, chat, ui-states specs (passcode-gated; global-setup signs in, see E2E_UI_PASSCODE)
 *   a11y   -> a11y.spec.ts (axe on every page) + a11y-keyboard.spec.ts
 */
const groups = Object.keys(E2E_GROUPS) as E2EGroup[];
const url = (g: E2EGroup) => `http://localhost:${E2E_GROUPS[g].port}`;
const match: Record<E2EGroup, RegExp> = {
  demo: /demo-path\.spec\.ts$/,
  agents: /agents\.spec\.ts$/,
  ui: /(replica|ui-a|ui-b|ui-states|chat)\.spec\.ts$/,
  a11y: /a11y(-keyboard)?\.spec\.ts$/,
};

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  globalSetup: "./tests/e2e/global-setup.ts",
  // CI runners compile dev routes far slower than a laptop; give assertions more room there.
  expect: { timeout: process.env.CI ? 15_000 : 5_000 },
  use: { trace: "retain-on-failure" },
  projects: groups.map((g) => ({
    name: g,
    testMatch: match[g],
    use: { ...devices["Desktop Chrome"], baseURL: url(g), ...(g === "ui" ? { storageState: E2E_UI_STATE } : {}) },
  })),
  webServer: groups.map((g) => ({
    command: `node_modules/.bin/tsx scripts/e2e-server.ts ${g}`,
    url: `${url(g)}/replica/tx-search`,
    reuseExistingServer: false,
    timeout: 300_000,
    gracefulShutdown: { signal: "SIGINT" as const, timeout: 15_000 },
    stdout: "pipe" as const,
  })),
});
