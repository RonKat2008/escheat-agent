/**
 * DESIGN-V3 slice 10: performance budgets (§8 item 10) and a hydration guard for the shell.
 *
 * Budgets need a production build: `next dev` ships unminified, unsplit JS. They run in the "perf" project, which
 * builds and serves the app (scripts/e2e-perf-server.ts):
 *   E2E_PERF=1 pnpm exec playwright test ui-v3-perf --project perf
 * Under the dev "ui" project the budget tests skip and only the hydration guard runs.
 *
 * JS weight = the sum of `encodedBodySize` (the compressed bytes on the wire, gzip from `next start`) of every script
 * resource that finished before the `load` event.
 */
import { expect, test, type Browser, type Page } from "playwright/test";
import { E2E_UI_PASSCODE } from "./env";
import { withFirstRunSeen } from "./first-run";

const IS_PROD = process.env.E2E_PERF === "1";
const LANDING_BUDGET_KB = 250;
const APP_BUDGET_KB = 300;
const LCP_BUDGET_MS = 2500;
const CLS_BUDGET = 0.1;

interface JsWeight {
  totalKb: number;
  files: { name: string; kb: number }[];
}

/** Compressed JS bytes fetched before `load`, largest first. */
async function initialJs(page: Page, path: string): Promise<JsWeight> {
  await page.goto(path, { waitUntil: "load" });
  return page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    const loadAt = nav?.loadEventStart || performance.now();
    const scripts = (performance.getEntriesByType("resource") as PerformanceResourceTiming[]).filter(
      (e) => e.responseEnd <= loadAt && (e.initiatorType === "script" || /\.m?js(\?|$)/.test(new URL(e.name).pathname)),
    );
    const files = scripts
      .map((e) => ({ name: new URL(e.name).pathname, kb: Math.round((e.encodedBodySize / 1024) * 10) / 10 }))
      .sort((a, b) => b.kb - a.kb);
    const total = scripts.reduce((sum, e) => sum + e.encodedBodySize, 0);
    return { totalKb: Math.round((total / 1024) * 10) / 10, files };
  });
}

/** The perf server is passcode-gated like production: sign in once through the real form, keep the cookie only. */
async function signedInState(browser: Browser, baseURL: string) {
  const ctx = await browser.newContext({ baseURL });
  const page = await ctx.newPage();
  await page.goto("/login", { waitUntil: "load" });
  // A fill that lands before hydration is reset and nothing submits (same retry as global-setup.ts).
  for (let attempt = 1; ; attempt++) {
    await page.getByLabel("Passcode").fill(E2E_UI_PASSCODE);
    await page.getByRole("button", { name: "Enter" }).click();
    try {
      await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 5_000 });
      break;
    } catch (err) {
      if (attempt >= 4) throw err;
    }
  }
  // The first-run welcome is answered up front so it never weighs on the budgets (tests/e2e/first-run.ts).
  const state = withFirstRunSeen(await ctx.storageState(), baseURL);
  await ctx.close();
  return state;
}

function report(label: string, w: JsWeight): string {
  return `${label}: ${w.totalKb} KB gz\n${w.files.map((f) => `  ${f.kb.toFixed(1).padStart(7)} KB  ${f.name}`).join("\n")}`;
}

test.describe("bundle budgets (production build)", () => {
  test.skip(!IS_PROD, "Budgets need a production server: E2E_PERF=1 playwright test ui-v3-perf --project perf");

  test(`landing initial JS is under ${LANDING_BUDGET_KB} KB gz`, async ({ page }) => {
    const w = await initialJs(page, "/");
    test.info().annotations.push({ type: "landing-js-kb", description: String(w.totalKb) });
    console.log(report("/", w));
    expect(w.files.length).toBeGreaterThan(0);
    expect(w.totalKb, report("/", w)).toBeLessThanOrEqual(LANDING_BUDGET_KB);
  });

  for (const path of ["/dashboard", "/items"]) {
    test(`${path} initial JS is under ${APP_BUDGET_KB} KB gz`, async ({ browser, baseURL }) => {
      // A fresh context (empty HTTP cache) with only the session cookie, so nothing is pre-warmed by /login.
      const ctx = await browser.newContext({ baseURL, storageState: await signedInState(browser, baseURL!) });
      const page = await ctx.newPage();
      const w = await initialJs(page, path);
      test.info().annotations.push({ type: `${path}-js-kb`, description: String(w.totalKb) });
      console.log(report(path, w));
      await expect(page).toHaveURL(new RegExp(`${path}$`)); // signed in: not redirected to /login
      await ctx.close();
      expect(w.totalKb, report(path, w)).toBeLessThanOrEqual(APP_BUDGET_KB);
    });
  }

  test(`/dashboard LCP < ${LCP_BUDGET_MS}ms and CLS < ${CLS_BUDGET}`, async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ baseURL, storageState: await signedInState(browser, baseURL!), viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto("/dashboard", { waitUntil: "load" });
    await page.waitForLoadState("networkidle").catch(() => undefined);
    // Buffered observers report everything since navigation start. LCP is final once input or hide happens; reading
    // the last buffered entry after the page settles is the same value web-vitals would report on hide.
    const vitals = await page.evaluate(
      () =>
        new Promise<{ lcp: number; cls: number }>((resolve) => {
          let lcp = 0;
          let cls = 0;
          new PerformanceObserver((list) => {
            for (const e of list.getEntries()) lcp = Math.max(lcp, e.startTime);
          }).observe({ type: "largest-contentful-paint", buffered: true });
          new PerformanceObserver((list) => {
            for (const e of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) {
              if (!e.hadRecentInput) cls += e.value;
            }
          }).observe({ type: "layout-shift", buffered: true });
          setTimeout(() => resolve({ lcp, cls }), 1500);
        }),
    );
    await expect(page).toHaveURL(/\/dashboard$/);
    await ctx.close();
    console.log(`/dashboard LCP ${Math.round(vitals.lcp)}ms, CLS ${vitals.cls.toFixed(4)}`);
    test.info().annotations.push({ type: "dashboard-vitals", description: JSON.stringify(vitals) });
    expect(vitals.lcp).toBeGreaterThan(0);
    expect(vitals.lcp).toBeLessThan(LCP_BUDGET_MS);
    expect(vitals.cls).toBeLessThan(CLS_BUDGET);
  });
});

test.describe("shell hydration", () => {
  test("no hydration error while navigating dashboard → items → reports → chat", async ({ browser, baseURL }) => {
    test.setTimeout(180_000);
    // The ui project's storageState is already signed in (global-setup); the perf project signs in here.
    const storageState = IS_PROD ? await signedInState(browser, baseURL!) : test.info().project.use.storageState;
    const page = await (await browser.newContext({ baseURL, storageState })).newPage();
    const errors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error" && /hydrat/i.test(m.text())) errors.push(m.text().slice(0, 4000));
    });
    page.on("pageerror", (e) => {
      if (/hydrat/i.test(e.message)) errors.push(`pageerror: ${e.message.slice(0, 400)}`);
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    // V4: no rail. Each hop opens the round menu and clicks in its sheet; the pill nav marks the section.
    const pills = page.getByRole("navigation", { name: "Sections" });

    // Each hop clicks as soon as the link exists, the way the close-out spec does, so a click can land while the
    // previous page's streamed shell is still hydrating.
    await page.goto("/dashboard", { waitUntil: "commit" });
    for (const [label, path, section] of [
      ["Items", "/items", "Work"],
      ["Reports", "/reports", "Setup"],
    ] as const) {
      await page.getByRole("button", { name: /^Open navigation/ }).click();
      await page.getByRole("dialog").getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: label, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`${path}(\\?|$)`), { timeout: 60_000 });
      await expect(pills.getByRole("link", { name: section, exact: true })).toHaveAttribute("aria-current", "page", { timeout: 60_000 });
    }
    // Also the hard-load path from the close-out spec: a fresh /reports document, then straight to chat.
    await page.goto("/reports?state=DE", { waitUntil: "commit" });
    await page.getByTestId("plan-close-out").first().click();
    // /chat redirects to /ask (ASK-MODE §1.3): Ask mode marks its switch segment and renders no section nav.
    await expect(page).toHaveURL(/\/ask/, { timeout: 60_000 });
    await expect(page.getByTestId("mode-ask")).toHaveAttribute("aria-current", "page", { timeout: 60_000 });
    await expect(pills).toHaveCount(0);
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await page.context().close();
    expect(errors).toEqual([]);
  });
});
