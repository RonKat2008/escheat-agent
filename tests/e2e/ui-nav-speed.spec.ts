/**
 * Navigation speed slice (docs/perf/2026-11-04-navigation.md).
 *  - Walks the main nav by clicking it (sidebar at 1024/1440, the mobile sheet at 375): every page renders its h1, its
 *    content (no skeleton left in <main>), the disclaimer, no horizontal overflow, and is axe-clean.
 *  - The route-transition hairline is present, idle after a navigation commits, and has no sweep under reduced motion.
 * Timing budgets are not asserted here (`next dev` compiles on demand); scripts/measure-nav.ts measures a production build.
 *   E2E_PORT=3944 E2E_DIR_SUFFIX=navspeed CI=1 pnpm exec playwright test tests/e2e/ui-nav-speed.spec.ts --project ui
 */
import { mkdirSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "playwright/test";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const SHOTS = ".data/shots/r4-nav-speed";
const DISCLAIMER = "Prototype. Not legal advice. Confirm filings with a qualified professional.";

/** Sidebar order, with the h1 each page renders. */
const NAV: readonly { href: string; label: string; h1: RegExp }[] = [
  { href: "/dashboard", label: "Dashboard", h1: /^Dashboard$/ },
  { href: "/items", label: "Items", h1: /^Items$/ },
  { href: "/payees", label: "Payees", h1: /^Payees$/ },
  { href: "/approvals", label: "Approvals", h1: /^Approvals$/ },
  { href: "/forecast", label: "Forecast", h1: /^Forecast$/ },
  { href: "/activity", label: "Activity", h1: /^Activity$/ },
  { href: "/rules", label: "Rules", h1: /^Rules$/ },
  { href: "/reports", label: "Reports", h1: /^Reports$/ },
  { href: "/recoveries", label: "Recoveries", h1: /^Recoveries$/ },
  { href: "/ask", label: "Ask", h1: /\S/ },
  { href: "/runs", label: "Agent runs", h1: /^Agent runs$/ },
  { href: "/eval", label: "Eval", h1: /^Eval$/ },
  { href: "/settings/integrations", label: "Settings", h1: /^Integrations$/ },
];

test.use({ reducedMotion: "reduce" });
test.beforeAll(() => mkdirSync(SHOTS, { recursive: true }));
test.beforeEach(({}, info) => test.skip(info.project.name !== "ui", "runs in the ui project only"));
test.describe.configure({ timeout: 600_000 });

async function axeBlocking(page: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page }).setLegacyMode(true).withTags(WCAG_TAGS).analyze();
  return violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
}
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

// V4: no rail at any width; every page is in the round menu's sheet (grouped Work / Books / Setup / Agents).
async function clickNav(page: Page, _width: number, item: (typeof NAV)[number]) {
  await page.getByRole("button", { name: /^Open navigation/ }).click();
  const sheet = page.getByRole("dialog");
  await sheet.locator(`nav[aria-label="Main navigation"] a[href="${item.href}"]`).click();
}

for (const width of [375, 1024, 1440] as const) {
  test(`main nav: every page renders its h1 and content, axe-clean, no overflow at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
    await page.goto("/runs", { timeout: 120_000 });
    await expect(page.locator("main h1")).toHaveText(/^Agent runs$/, { timeout: 90_000 });

    for (const item of NAV) {
      await clickNav(page, width, item);
      await expect(page).toHaveURL(new RegExp(`${item.href}(\\?|$)`), { timeout: 90_000 });
      await expect(page.locator("main h1").first()).toHaveText(item.h1, { timeout: 90_000 });
      await expect(page.locator('main [aria-busy="true"]')).toHaveCount(0, { timeout: 90_000 });
      await expect(page.getByText(DISCLAIMER).first()).toBeVisible();
      // The navigation committed, so the hairline is idle again.
      await expect(page.getByTestId("nav-progress")).toHaveAttribute("data-pending", "false");
      expect(await overflow(page), `${item.href} overflows at ${width}`).toBeLessThanOrEqual(0);
      expect(await axeBlocking(page), `${item.href} axe at ${width}`).toEqual([]);
    }
    await page.screenshot({ path: `${SHOTS}/settings-after-nav-${width}.png` });
  });
}

test("route-transition hairline: hidden from assistive tech, electric blue, no sweep under reduced motion", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/dashboard", { timeout: 120_000 });
  const bar = page.getByTestId("nav-progress");
  await expect(bar).toHaveAttribute("aria-hidden", "true");
  await expect(bar).toHaveAttribute("data-pending", "false");
  await expect(bar).toHaveCSS("opacity", "0");
  const fill = bar.locator(".nav-progress-bar");
  await expect(fill).toHaveCSS("animation-name", "none");
  // The palette's electric blue (--color-blue-500), not an ad-hoc color.
  const [actual, token] = await fill.evaluate((el) => {
    const probe = document.createElement("div");
    probe.style.backgroundColor = "var(--color-blue-500)";
    document.body.append(probe);
    const t = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return [getComputedStyle(el).backgroundColor, t];
  });
  expect(actual).toBe(token);
  await page.screenshot({ path: `${SHOTS}/dashboard-1440.png` });
});
