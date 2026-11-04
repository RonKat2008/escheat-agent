/**
 * Round 7, "runs + claims" slice (R6-11, R6-19, R6-18 remainder, claims list).
 *  - The seed writes one honest scripted filing dry run, so Agent runs always has a meaningful row labelled
 *    "Scripted (no model)"; the seed's classifier rows are "Heuristic (no model)"; never "No runs match" with no filter.
 *  - The replica search portal lists Filed claims (empty state here; rows appear after a claim is filed).
 *   ESCHEAT_OFFLINE=1 E2E_PORT=3933 E2E_DIR_SUFFIX=r7runs CI=1 pnpm exec playwright test tests/e2e/ui-r7-runs.spec.ts --project ui
 */
import { mkdirSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "playwright/test";

const DISCLAIMER = "Prototype. Not legal advice. Confirm filings with a qualified professional.";
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const SHOTS = ".data/shots/r7-runs";
const WIDTHS = [375, 1024, 1440] as const;

test.use({ reducedMotion: "reduce" });
test.beforeAll(() => mkdirSync(SHOTS, { recursive: true }));
test.beforeEach(({}, info) => test.skip(info.project.name !== "ui", "runs in the ui project only"));
test.describe.configure({ timeout: 180_000 });

async function axeBlocking(page: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page }).setLegacyMode(true).withTags(WCAG_TAGS).analyze();
  return violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
}
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test("a fresh seed opens Agent runs on a scripted filing dry run, never an empty 'no match'", async ({ page }) => {
  for (const w of WIDTHS) {
    await page.setViewportSize({ width: w, height: w === 375 ? 812 : 900 });
    await page.goto("/runs", { timeout: 90_000 });
    await expect(page.getByRole("heading", { name: "Agent runs" })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(DISCLAIMER)).toBeVisible();
    await expect(page.getByText("No runs match these filters.")).toHaveCount(0);
    await expect(page.getByTestId("scripted-label").first()).toHaveText("Scripted (no model)");
    expect(await overflow(page), `overflow at ${w}`).toBeLessThanOrEqual(0);
    if (w !== 1024) await page.screenshot({ path: `${SHOTS}/runs-${w}.png` });
  }
  expect(await axeBlocking(page)).toEqual([]);
});

test("the seed's classifier rows are labelled Heuristic (no model) and the chip and row use one word", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/runs?replays=1&agent=classifier", { timeout: 90_000 });
  await expect(page.getByRole("heading", { name: "Agent runs" })).toBeVisible({ timeout: 60_000 });
  const heuristic = page.getByTestId("heuristic-label");
  if (await heuristic.count()) await expect(heuristic.first()).toHaveText("Heuristic (no model)");
  await expect(page.locator('[data-status="cancelled"]')).toHaveCount(0);
});

test("the replica search portal lists Filed claims", async ({ page }) => {
  for (const w of WIDTHS) {
    await page.setViewportSize({ width: w, height: w === 375 ? 812 : 900 });
    await page.goto("/replica/tx-search/claims", { timeout: 90_000 });
    await expect(page.getByRole("heading", { name: /Filed claims/ })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("filed-claims")).toBeVisible();
    expect(await overflow(page), `overflow at ${w}`).toBeLessThanOrEqual(0);
    if (w !== 1024) await page.screenshot({ path: `${SHOTS}/claims-${w}.png` });
  }
  expect(await axeBlocking(page)).toEqual([]);
});
