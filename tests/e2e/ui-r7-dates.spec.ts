/**
 * Round 7, "dates + counts" slice (R6-12, R6-16): the demo date (Nov 1, 2026), not the real clock, on Activity and Reports;
 * the dashboard's By status shows cents and the same word as the Money Flow for a resolved item.
 *   E2E_PORT=3922 E2E_DIR_SUFFIX=r7dates CI=1 pnpm exec playwright test tests/e2e/ui-r7-dates.spec.ts --project ui
 */
import { mkdirSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "playwright/test";
import { openDashboardDetail } from "./dashboard-detail";

const SHOTS = ".data/shots/r7-dates";
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const WIDTHS = [375, 1024, 1440] as const;

test.use({ reducedMotion: "reduce" });
test.beforeAll(() => mkdirSync(SHOTS, { recursive: true }));
test.beforeEach(({}, info) => test.skip(info.project.name !== "ui", "runs in the ui project only"));
test.describe.configure({ timeout: 180_000 });

const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
async function axeBlocking(page: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page }).setLegacyMode(true).withTags(WCAG_TAGS).analyze();
  return violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
}

test("R6-12: Activity labels its day with the demo date, never a day after it", async ({ page }) => {
  for (const w of WIDTHS) {
    await page.setViewportSize({ width: w, height: w === 375 ? 812 : 900 });
    await page.goto("/activity", { timeout: 90_000 });
    const heading = page.getByTestId("activity-strip").getByRole("heading");
    // R8-09: every clock jump is now an Activity entry on the demo day it moved to, so after another spec in the shared
    // DB jumps and resets, a later demo day can legitimately head the feed. What R6-12 guards is today's group: it is
    // labelled with the demo date, and nothing is grouped under the real wall-clock date.
    await expect(heading).toContainText(/entr(y|ies) (on [A-Z][a-z]{2} \d{1,2}, \d{4} \(demo day\), by hour written|from [A-Z][a-z]{2} \d{1,2}, \d{4} to [A-Z][a-z]{2} \d{1,2}, \d{4}, by day)/, { timeout: 60_000 });
    await expect(page.locator('[data-testid="activity-day"][data-day="2026-11-01"]').first().getByRole("heading")).toContainText("Nov 1, 2026");
    const realDay = new Date().toISOString().slice(0, 10);
    if (realDay > "2026-11-01") await expect(page.locator(`[data-testid="activity-day"][data-day="${realDay}"]`)).toHaveCount(0);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `${SHOTS}/activity-${w}.png`, fullPage: false });
  }
  expect(await axeBlocking(page)).toEqual([]);
});

test("R6-16: By status shows cents and one word for a resolved item; deadlines are pluralised", async ({ page }) => {
  for (const w of [375, 1440] as const) {
    await page.setViewportSize({ width: w, height: w === 375 ? 812 : 900 });
    await page.goto("/dashboard", { timeout: 90_000 });
    await openDashboardDetail(page);
    const panel = page.getByRole("region", { name: "By status" }).or(page.locator("section", { has: page.getByRole("heading", { name: "By status" }) }));
    await expect(panel.first()).toBeVisible({ timeout: 60_000 });
    const text = (await panel.first().innerText()).replace(/\s+/g, " ");
    expect(text).toMatch(/\$[\d,]+\.\d{2}/);
    expect(text).not.toContain("Paid out");
    expect(await page.locator("body").innerText()).not.toMatch(/\b1 deadlines\b/);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `${SHOTS}/dashboard-${w}.png`, fullPage: true });
  }
  expect(await axeBlocking(page)).toEqual([]);
});
