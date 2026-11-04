import { chromium, type BrowserContext, type Page } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { E2E_GROUPS, E2E_UI_PASSCODE, E2E_UI_STATE, type E2EGroup } from "./env";
import { FIRST_RUN_KEY } from "./first-run";

/**
 * Warm every e2e dev server before the specs run. `next dev` compiles a route (server and client chunks) on its
 * first request; on slow CI runners that first compile outlasts the 5s assertion window and the specs start
 * typing into pages that have not hydrated yet. Read-only GETs only: nothing here changes demo state.
 */
const PAGES = ["/dashboard", "/items?item=10482", "/approvals", "/forecast", "/rules", "/reports", "/recoveries", "/runs", "/eval", "/settings/integrations", "/replica/tx-search", "/replica/ca-holder"];
/**
 * Routes that only the scripted agents' own fresh Chromium hits (sign-in landing, upload, review, claim pages), plus
 * the agent API handlers. Without this the first agent run pays their dev compile inside its step budget. Ids are
 * bogus on purpose: a 404 still compiles the route; API routes are hit with GET (a 4xx/405 still compiles them).
 */
const AGENT_PAGES = [
  "/replica/ca-holder/dashboard",
  "/replica/ca-holder/upload",
  "/replica/ca-holder/review/warmup",
  "/replica/ca-holder/confirmation/warmup",
  "/replica/tx-search/claim/warmup",
  "/replica/tx-search/claim-confirmation/warmup",
];
const AGENT_API = ["/api/agents/runs/warmup", "/api/agents/reports?id=warmup", "/api/agents/file", "/api/agents/recover", "/api/agents/claim"];

/** The ui server is passcode-gated (E2E_UI_PASSCODE): sign in once through the real form and save the session for the ui project. */
async function signInUi(page: Page, context: BrowserContext): Promise<void> {
  await page.goto("/login", { waitUntil: "load", timeout: 180_000 });
  // On a cold CI runner the first fill can land before hydration, which resets the field and nothing is submitted.
  // Retry the real form until the session cookie lands instead of waiting once for a submit that never happened.
  const deadline = Date.now() + 180_000;
  for (;;) {
    await page.getByLabel("Passcode").fill(E2E_UI_PASSCODE);
    await page.getByRole("button", { name: "Enter" }).click();
    try {
      await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20_000 });
      break;
    } catch (err) {
      if (Date.now() > deadline) throw err;
    }
  }
  // The first-run welcome is answered up front so it never covers what the ui specs test (tests/e2e/first-run.ts).
  await page.evaluate((key) => localStorage.setItem(key, "skipped"), FIRST_RUN_KEY);
  mkdirSync(path.dirname(E2E_UI_STATE), { recursive: true });
  await context.storageState({ path: E2E_UI_STATE });
}

export default async function globalSetup(): Promise<void> {
  const browser = await chromium.launch();
  try {
    // Only the servers playwright.config.ts started for the selected projects (E2E_ACTIVE_GROUPS); all when unset.
    const active = process.env.E2E_ACTIVE_GROUPS?.split(",").filter(Boolean);
    for (const group of (Object.keys(E2E_GROUPS) as E2EGroup[]).filter((g) => !active?.length || active.includes(g))) {
      const context = await browser.newContext({ baseURL: `http://localhost:${E2E_GROUPS[group].port}` });
      const page = await context.newPage();
      if (group === "ui") await signInUi(page, context);
      for (const path of PAGES) {
        // A page that 404s or errors is still compiled; the specs report real failures.
        await page.goto(path, { waitUntil: "networkidle", timeout: 180_000 }).catch(() => undefined);
      }
      for (const path of AGENT_PAGES) await page.goto(path, { waitUntil: "load", timeout: 180_000 }).catch(() => undefined);
      for (const path of AGENT_API) await page.request.get(path, { timeout: 180_000 }).catch(() => undefined);
      await context.close();
    }
  } finally {
    await browser.close();
  }
}
