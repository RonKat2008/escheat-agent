/**
 * Round 8, tour and shell slice (R8-05, R8-06, R8-11, R8-15, R8-16 and the clock toast).
 *  - R8-06: Esc and Exit remove the tour at once and drop ?tour= from the URL.
 *  - R8-15: ?tour=99 lands on the last stop and the URL says so (no hang on "Opening this screen...").
 *  - R8-11: at 375 a toast raised while the tour is open does not overlap the tour sheet.
 *  - R8-16: the Ledger and Audit popovers do not cover the figure they talk about; the item drawer shows one
 *    "Lifecycle" heading.
 *  - R8-05: Ledger and Horizon never show a skeleton for a navigation that finishes inside the hold (nav-hold.ts).
 *  - Clock toast: the +90d move toasts the API's own detected count and amount (blue, link to /items), or says nothing.
 *  - axe (legacy mode) clean, no horizontal overflow at 375/1024/1440. Shots in .data/shots/r8-tour/.
 *   E2E_PORT=3994 E2E_DIR_SUFFIX=r8tour CI=1 pnpm exec playwright test tests/e2e/ui-r8-tour.spec.ts --project ui
 */
import { mkdirSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "playwright/test";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const SHOTS = ".data/shots/r8-tour";
const WIDTHS = [375, 1024, 1440] as const;

test.use({ reducedMotion: "reduce" });
test.beforeAll(() => mkdirSync(SHOTS, { recursive: true }));
test.beforeEach(({}, info) => test.skip(info.project.name !== "ui", "runs in the ui project only"));
test.describe.configure({ timeout: 360_000 });

const tour = (page: Page) => page.getByTestId("judge-tour");
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

async function axeBlocking(page: Page, scope?: string): Promise<string[]> {
  const b = new AxeBuilder({ page }).setLegacyMode(true).withTags(WCAG_TAGS);
  const { violations } = await (scope ? b.include(scope) : b).analyze();
  return violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
}

async function openStop(page: Page, path: string, n: number) {
  await page.goto(`${path}?tour=${n}`, { timeout: 120_000 });
  await expect(tour(page)).toHaveAttribute("data-index", String(n), { timeout: 120_000 });
  await expect(tour(page)).toHaveAttribute("data-phase", "ready", { timeout: 120_000 });
}

/** Press Next until the tour is on stop `id` (the number depends on which optional stops this build has). */
async function nextUntil(page: Page, id: string) {
  await expect(tour(page)).toHaveAttribute("data-phase", "ready", { timeout: 120_000 });
  for (let i = 0; i < 20; i++) {
    const idx = await tour(page).getAttribute("data-index");
    if ((await tour(page).getAttribute("data-step")) === id) return;
    await page.getByTestId("tour-next").click();
    await expect(tour(page)).not.toHaveAttribute("data-index", idx ?? "", { timeout: 60_000 });
    await expect(tour(page)).toHaveAttribute("data-phase", "ready", { timeout: 120_000 });
  }
  throw new Error(`stop ${id} not reached`);
}

test("R8-06: Esc and Exit close the tour at once and drop ?tour=", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openStop(page, "/dashboard", 1);
  let t = Date.now();
  await page.keyboard.press("Escape");
  await expect(tour(page)).toHaveCount(0, { timeout: 1_000 });
  expect(Date.now() - t, "Esc closes within a second").toBeLessThan(1_000);
  await expect.poll(() => new URL(page.url()).searchParams.has("tour")).toBe(false);

  await openStop(page, "/dashboard", 1);
  t = Date.now();
  await page.getByTestId("tour-close").click();
  await expect(tour(page)).toHaveCount(0, { timeout: 1_000 });
  expect(Date.now() - t, "Exit closes within a second").toBeLessThan(1_000);
  await expect.poll(() => new URL(page.url()).searchParams.has("tour")).toBe(false);
});

test("R8-15: ?tour=99 lands on the last stop, with the URL to match", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/dashboard?tour=99", { timeout: 120_000 });
  await expect(tour(page)).toHaveAttribute("data-phase", "ready", { timeout: 120_000 });
  const total = Number(await tour(page).getAttribute("data-total"));
  await expect(tour(page)).toHaveAttribute("data-index", String(total));
  await expect.poll(() => new URL(page.url()).searchParams.get("tour")).toBe(String(total));
  await expect(page.getByTestId("tour-status")).toHaveCount(0);
  await page.getByTestId("tour-close").click();
  await expect(tour(page)).toHaveCount(0);
});

test("R8-16: the Ledger and Audit popovers leave their figure uncovered", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const cases = [
    { path: "/ledger", id: "ledger", figure: '[data-testid="ledger-closing"]' },
    { path: "/audit", id: "audit", figure: "#audit-summary-h" },
  ];
  for (const c of cases) {
    // The stop's number depends on which optional stops this build has, so find it by id.
    await page.goto("/dashboard?tour=1", { timeout: 120_000 });
    await expect(tour(page)).toHaveAttribute("data-phase", "ready", { timeout: 120_000 });
    await nextUntil(page, c.id);
    await expect(tour(page)).toHaveAttribute("data-step", c.id);
    await page.waitForTimeout(500);
    const pop = await page.getByTestId("tour-popover").boundingBox();
    const fig = await page.locator(c.figure).first().boundingBox();
    expect(pop && fig, `${c.id} boxes`).toBeTruthy();
    if (pop && fig) {
      const hit = pop.x < fig.x + fig.width && pop.x + pop.width > fig.x && pop.y < fig.y + fig.height && pop.y + pop.height > fig.y;
      expect(hit, `${c.id} popover covers ${c.figure}`).toBe(false);
    }
    await page.screenshot({ path: `${SHOTS}/${c.id}-1440.png` });
  }
});

test("R8-16: the item drawer shows one Lifecycle heading at 375", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/items?tour=3", { timeout: 120_000 });
  await expect(tour(page)).toHaveAttribute("data-phase", "ready", { timeout: 120_000 });
  const visible = await page.getByTestId("item-lifecycle").getByText("Lifecycle", { exact: true }).evaluateAll((els) =>
    els.filter((e) => {
      const r = e.getBoundingClientRect();
      return r.width > 1 && r.height > 1 && getComputedStyle(e).position !== "absolute";
    }).length,
  );
  expect(visible, "visible Lifecycle headings").toBe(1);
  await page.screenshot({ path: `${SHOTS}/item-375.png` });
});

test("R8-11: at 375 a toast raised during the tour stays clear of the tour sheet", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/dashboard?tour=1", { timeout: 120_000 });
  await expect(tour(page)).toHaveAttribute("data-phase", "ready", { timeout: 120_000 });
  await nextUntil(page, "recoveries");
  await expect(tour(page)).toHaveAttribute("data-step", "recoveries");
  await page.getByTestId("tour-invite-btn").click();
  const toast = page.locator("[data-sonner-toast]").first();
  await expect(toast).toBeVisible({ timeout: 180_000 });
  await page.waitForTimeout(600);
  const t = await toast.boundingBox();
  const p = await page.getByTestId("tour-popover").boundingBox();
  expect(t && p).toBeTruthy();
  if (t && p) expect(t.y + t.height, "toast sits above the sheet").toBeLessThanOrEqual(p.y + 1);
  await page.screenshot({ path: `${SHOTS}/toast-above-sheet-375.png` });
});

test("R8-05: Ledger and Horizon do not flash a skeleton on a quick navigation", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/dashboard", { timeout: 120_000 });
  await expect(page.locator("main h1").first()).toBeVisible({ timeout: 90_000 });
  for (const href of ["/ledger", "/horizon", "/ledger"]) {
    // Warm the route first (dev compiles on demand), so the measured click is the fast case.
    await page.request.get(href).catch(() => undefined);
    await page.evaluate(() => {
      const w = window as unknown as { __skel: number };
      w.__skel = 0;
      new MutationObserver(() => {
        if (document.querySelector('main [aria-busy="true"]')) w.__skel += 1;
      }).observe(document.body, { subtree: true, childList: true, attributes: true });
    });
    await page.getByRole("complementary", { name: "Sidebar" }).locator(`a[href="${href}"]`).click();
    await expect(page).toHaveURL(new RegExp(`${href}$`), { timeout: 90_000 });
    await expect(page.locator('main [aria-busy="true"]')).toHaveCount(0, { timeout: 90_000 });
    const skel = await page.evaluate(() => (window as unknown as { __skel: number }).__skel);
    // Dev compiles pages slowly, so a skeleton after the hold is allowed there; a production run must see none.
    if (process.env.E2E_PROD === "1") expect(skel, `${href} skeleton mutations`).toBe(0);
  }
});

test("clock toast: +90d toasts the API's own detected count and amount in blue, or says nothing", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/dashboard", { timeout: 120_000 });
  await expect(page.getByTestId("demo-date")).toBeVisible({ timeout: 90_000 });
  try {
    await page.getByRole("button", { name: /^Demo clock/ }).click();
    const respP = page.waitForResponse((r) => r.url().endsWith("/api/clock") && r.request().method() === "POST");
    await page.getByRole("button", { name: "+90d" }).click();
    const json = (await (await respP).json()) as { detected: { count: number; cents: number } };
    const detected = page.locator("[data-sonner-toast]", { hasText: /detected ·/ });
    if (json.detected.count > 0) {
      const usd = (json.detected.cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
      const noun = json.detected.count === 1 ? "1 new stale item" : `${json.detected.count.toLocaleString("en-US")} new stale items`;
      await expect(detected).toContainText(`${noun} detected · ${usd}`, { timeout: 30_000 });
      await expect(detected.getByRole("button", { name: "Open items" })).toBeVisible();
      await expect(detected.locator('svg[class*="text-blue"]')).toHaveCount(1);
      await expect(detected.locator('svg[class*="text-pink"], svg[class*="text-green"]')).toHaveCount(0);
      await page.screenshot({ path: `${SHOTS}/clock-toast-1440.png` });
      await detected.getByRole("button", { name: "Open items" }).click();
      await expect(page).toHaveURL(/\/items/);
    } else {
      await page.waitForTimeout(1_500);
      await expect(detected).toHaveCount(0);
    }
  } finally {
    await page.request.post("/api/clock", { data: { action: "reset" } });
  }
});

for (const width of WIDTHS) {
  test(`tour popover: axe-clean and no overflow at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
    await openStop(page, "/dashboard", 1);
    expect(await overflow(page), `overflow at ${width}`).toBeLessThanOrEqual(0);
    expect(await axeBlocking(page, '[data-testid="tour-popover"]'), `axe at ${width}`).toEqual([]);
    await page.screenshot({ path: `${SHOTS}/tour-${width}.png` });
  });
}
