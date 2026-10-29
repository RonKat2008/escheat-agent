import { defineConfig, devices } from "playwright/test";
import { E2E_GROUPS, type E2EGroup } from "./tests/e2e/env";

/**
 * Three isolated servers (each re-seeds its own PGlite dir via scripts/e2e-server.ts), because the specs
 * mutate shared state (filing a report, claiming a recovery, resolving items):
 *   demo   -> demo-path.spec.ts   (fresh demo start, the BRIEF's path end to end)
 *   agents -> agents.spec.ts
 *   ui     -> replica, ui-a, ui-b specs
 */
const groups = Object.keys(E2E_GROUPS) as E2EGroup[];
const url = (g: E2EGroup) => `http://localhost:${E2E_GROUPS[g].port}`;
const match: Record<E2EGroup, RegExp> = {
  demo: /demo-path\.spec\.ts$/,
  agents: /agents\.spec\.ts$/,
  ui: /(replica|ui-a|ui-b)\.spec\.ts$/,
};

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: { trace: "retain-on-failure" },
  projects: groups.map((g) => ({
    name: g,
    testMatch: match[g],
    use: { ...devices["Desktop Chrome"], baseURL: url(g) },
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
