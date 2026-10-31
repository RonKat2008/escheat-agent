import { chromium } from "playwright";
import { E2E_GROUPS, type E2EGroup } from "./env";

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

export default async function globalSetup(): Promise<void> {
  const browser = await chromium.launch();
  try {
    for (const group of Object.keys(E2E_GROUPS) as E2EGroup[]) {
      const page = await browser.newPage({ baseURL: `http://localhost:${E2E_GROUPS[group].port}` });
      for (const path of PAGES) {
        // A page that 404s or errors is still compiled; the specs report real failures.
        await page.goto(path, { waitUntil: "networkidle", timeout: 180_000 }).catch(() => undefined);
      }
      for (const path of AGENT_PAGES) await page.goto(path, { waitUntil: "load", timeout: 180_000 }).catch(() => undefined);
      for (const path of AGENT_API) await page.request.get(path, { timeout: 180_000 }).catch(() => undefined);
      await page.close();
    }
  } finally {
    await browser.close();
  }
}
