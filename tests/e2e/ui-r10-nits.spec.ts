/**
 * Round 10 nits: ledger account names readable at 375, Horizon tour copy, years on Activity strip dates, axe on touched pages.
 *   E2E_PORT=3981 E2E_DIR_SUFFIX=nits CI=1 pnpm exec playwright test tests/e2e/ui-r10-nits.spec.ts --project ui --workers=1
 */
import { mkdirSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "playwright/test";
import { TOUR_STEPS } from "../../src/components/tour/steps";

const SHOTS = ".data/shots/r10-nits";
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
const size = (w: number) => ({ width: w, height: w === 375 ? 812 : 900 });

test("ledger at 375: the TX account name is fully visible, no page overflow", async ({ page }) => {
  await page.setViewportSize(size(375));
  await page.goto("/ledger", { timeout: 90_000 });
  const tx = page.locator('[data-testid="je-state"][data-state="TX"]').first();
  await expect(tx).toBeVisible({ timeout: 60_000 });
  const cell = tx.locator("td", { hasText: "Unclaimed property payable (TX)" }).first();
  await cell.scrollIntoViewIfNeeded();
  const box = await cell.boundingBox();
  const scroller = await tx.locator(".es-scroll-x").boundingBox();
  expect(box && scroller).toBeTruthy();
  // Not clipped by the horizontal scroller: the whole name sits inside the visible region, and it wraps rather than truncating.
  expect(box!.x).toBeGreaterThanOrEqual(scroller!.x - 1);
  expect(box!.x + box!.width).toBeLessThanOrEqual(scroller!.x + scroller!.width + 1);
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  await tx.screenshot({ path: `${SHOTS}/ledger-tx-375.png` });
});

test("Horizon tour step describes what the page shows", async ({ page }) => {
  const n = TOUR_STEPS.findIndex((s) => s.id === "horizon") + 1;
  await page.goto(`/dashboard?tour=${n}`, { timeout: 120_000 });
  const narration = page.getByTestId("tour-narration");
  await expect(narration).toContainText("about to go stale", { timeout: 120_000 });
  await expect(narration).not.toContainText("costs to resolve");
  await page.screenshot({ path: `${SHOTS}/tour-horizon.png` });
});

test("Activity strip dates carry a year", async ({ page }) => {
  for (const w of WIDTHS) {
    await page.setViewportSize(size(w));
    await page.goto("/activity", { timeout: 90_000 });
    const strip = page.getByTestId("activity-strip");
    await expect(strip.getByRole("heading")).toContainText(/20\d\d/, { timeout: 60_000 });
    const firstDay = page.getByTestId("activity-day").first().getByRole("heading");
    await expect(firstDay).toContainText(/20\d\d/);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `${SHOTS}/activity-${w}.png` });
  }
});

test("axe is clean on the touched pages at 375/1024/1440", async ({ page }) => {
  for (const path of ["/ledger", "/activity", "/horizon"]) {
    for (const w of WIDTHS) {
      await page.setViewportSize(size(w));
      await page.goto(path, { timeout: 90_000 });
      await expect(page.locator("main h1")).toBeVisible({ timeout: 60_000 });
      await expect(page.locator("main [aria-busy=true]")).toHaveCount(0, { timeout: 60_000 });
      expect(await axeBlocking(page), `${path} at ${w}`).toEqual([]);
      expect(await overflow(page), `${path} overflow at ${w}`).toBeLessThanOrEqual(0);
    }
  }
});
