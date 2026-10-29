import { chromium } from "playwright";
import { E2E_GROUPS, type E2EGroup } from "./env";

/**
 * Warm every e2e dev server before the specs run. `next dev` compiles a route (server and client chunks) on its
 * first request; on slow CI runners that first compile outlasts the 5s assertion window and the specs start
 * typing into pages that have not hydrated yet. Read-only GETs only: nothing here changes demo state.
 */
const PAGES = ["/dashboard", "/items?item=10482", "/approvals", "/rules", "/reports", "/recoveries", "/runs", "/eval", "/settings/integrations", "/replica/tx-search", "/replica/ca-holder"];

export default async function globalSetup(): Promise<void> {
  const browser = await chromium.launch();
  try {
    for (const group of Object.keys(E2E_GROUPS) as E2EGroup[]) {
      const page = await browser.newPage({ baseURL: `http://localhost:${E2E_GROUPS[group].port}` });
      for (const path of PAGES) {
        // A page that 404s or errors is still compiled; the specs report real failures.
        await page.goto(path, { waitUntil: "networkidle", timeout: 180_000 }).catch(() => undefined);
      }
      await page.close();
    }
  } finally {
    await browser.close();
  }
}
