import { chromium, type BrowserContext, type Page } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { E2E_GROUPS, E2E_UI_PASSCODE, E2E_UI_STATE, type E2EGroup } from "./env";

/**
 * Warm every e2e dev server before the specs run. `next dev` compiles a route (server and client chunks) on its
 * first request; on slow CI runners that first compile outlasts the 5s assertion window and the specs start
 * typing into pages that have not hydrated yet. Read-only GETs only: nothing here changes demo state.
 */
const PAGES = ["/dashboard", "/items?item=10482", "/approvals", "/rules", "/reports", "/recoveries", "/runs", "/eval", "/settings/integrations", "/replica/tx-search", "/replica/ca-holder"];
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
  await page.getByLabel("Passcode").fill(E2E_UI_PASSCODE);
  await page.getByRole("button", { name: "Enter" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 180_000 });
  mkdirSync(path.dirname(E2E_UI_STATE), { recursive: true });
  await context.storageState({ path: E2E_UI_STATE });
}

export default async function globalSetup(): Promise<void> {
  const browser = await chromium.launch();
  try {
    for (const group of Object.keys(E2E_GROUPS) as E2EGroup[]) {
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
