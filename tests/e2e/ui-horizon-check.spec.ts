/**
 * "Horizon said so" (round 9, opportunity #2): the Prediction check panel on /horizon compares Horizon's stored forecast
 * (made on the previous demo day, inside the clock move's transaction) with what the move detected.
 *  - Reset, advance +30 days via POST /api/clock, then the panel shows the predicted and detected counts with equal
 *    amounts, and both equal what the clock response says it detected. No fresh-seed constants: every number is compared
 *    with another number from the same run, so it holds on the shared ui DB.
 *  - Matched rows link to /items?item=<id> and the drawer opens.
 *  - axe (legacy mode) clean, no horizontal overflow at 375/1024/1440. Screenshots in .data/shots/horizon-check/.
 * Mutates the clock and resets it in `finally`:
 *   E2E_PORT=3982 E2E_DIR_SUFFIX=hcheck CI=1 pnpm exec playwright test tests/e2e/ui-horizon-check.spec.ts --project ui
 */
import { mkdirSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "playwright/test";
import { finishAnimations } from "./animations";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const DISCLAIMER = "Prototype. Not legal advice. Confirm filings with a qualified professional.";
const SHOTS = ".data/shots/horizon-check";
const WIDTHS = [375, 1024, 1440] as const;

test.use({ reducedMotion: "reduce" });
test.beforeAll(() => mkdirSync(SHOTS, { recursive: true }));
test.beforeEach(({}, info) => test.skip(info.project.name !== "ui", "runs in the ui project only"));
test.describe.configure({ timeout: 360_000 });

async function axeBlocking(page: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page }).setLegacyMode(true).withTags(WCAG_TAGS).analyze();
  return violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
}
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

async function openHorizon(page: Page) {
  await page.goto("/horizon", { timeout: 90_000 });
  await expect(page.getByTestId("prediction-check")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(DISCLAIMER).first()).toBeVisible();
}

interface ClockResponse {
  today: string;
  detected: { count: number; cents: number };
}

async function post(page: Page, data: Record<string, unknown>): Promise<ClockResponse> {
  const res = await page.request.post("/api/clock", { data });
  expect(res.status(), await res.text()).toBeLessThan(300);
  return (await res.json()) as ClockResponse;
}

test("Prediction check: +30 days, Horizon's forecast equals the detection to the cent, rows link to items", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const start = await post(page, { action: "reset" });
  try {
    const moved = await post(page, { action: "advance", days: 30 });
    await openHorizon(page);

    const latest = page.getByTestId("check-latest");
    await expect(latest).toBeVisible();
    const num = async (attr: string) => Number(await latest.getAttribute(attr));
    const predictedCount = await num("data-predicted-count");
    const predictedCents = await num("data-predicted-cents");
    expect(await num("data-detected-count")).toBe(moved.detected.count);
    expect(await num("data-detected-cents")).toBe(moved.detected.cents);
    // Horizon said so: the forecast made on the previous day equals what the move detected.
    expect(predictedCount).toBe(moved.detected.count);
    expect(predictedCents).toBe(moved.detected.cents);
    await expect(latest).toHaveAttribute("data-status", "all");
    await expect(page.getByTestId("check-status")).toHaveText(predictedCount === 0 ? "Nothing predicted, nothing detected" : `All ${predictedCount} detected`);

    const sentence = page.getByTestId("check-sentence");
    await expect(sentence).toContainText(`Horizon predicted ${predictedCount} payment`);
    await expect(sentence).toContainText(`${moved.detected.count} ${moved.detected.count === 1 ? "was" : "were"} detected`);
    const dollars = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    await expect(sentence).toContainText(`(${dollars(predictedCents)}) would go stale`);
    await expect(sentence).toContainText(`detected (${dollars(moved.detected.cents)})`);
    await expect(page.getByTestId("check-row-missed")).toHaveCount(0);
    await expect(page.getByTestId("check-row-unexpected")).toHaveCount(0);

    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      if (width !== WIDTHS[0]) await openHorizon(page);
      await finishAnimations(page);
      expect(await overflow(page), `no horizontal overflow at ${width}`).toBeLessThanOrEqual(0);
      expect(await axeBlocking(page), `axe at ${width}`).toEqual([]);
      await page.getByTestId("prediction-check").screenshot({ path: `${SHOTS}/panel-${width}.png` });
    }
    await page.screenshot({ path: `${SHOTS}/horizon-check-1440.png`, fullPage: false });

    if (predictedCount > 0) {
      await expect(page.getByTestId("check-row-matched")).toHaveCount(Math.min(predictedCount, 12));
      // Links: a matched row opens that item's drawer on /items (the last step, so nothing re-opens /horizon after).
      const link = page.getByTestId("check-link-detected").first();
      expect(await link.getAttribute("href")).toMatch(/^\/items\?item=[0-9a-f-]{36}$/);
      await link.click();
      await expect(page).toHaveURL(/\/items\?item=/);
      await expect(page.getByTestId("item-drawer")).toBeVisible({ timeout: 60_000 });
    }
  } finally {
    const back = await post(page, { action: "reset" });
    expect(back.today).toBe(start.today);
  }
});
