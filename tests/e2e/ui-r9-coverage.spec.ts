/**
 * Round 9, R9-03: items owed to states with no rules file (FL, IL, NY, OR) join the total after the clock moves, and
 * every surface says so the same way: "Not covered yet: ... · N items · $X", with the same count and amount.
 *   E2E_PORT=3984 E2E_DIR_SUFFIX=r9cov CI=1 pnpm exec playwright test tests/e2e/ui-r9-coverage.spec.ts --project ui
 */
import { mkdirSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "playwright/test";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const SHOTS = ".data/shots/r9-coverage";
const WIDTHS = [375, 1024, 1440] as const;

test.use({ reducedMotion: "reduce" });
test.beforeAll(() => mkdirSync(SHOTS, { recursive: true }));
test.beforeEach(({}, info) => test.skip(info.project.name !== "ui", "runs in the ui project only"));
test.describe.configure({ timeout: 300_000, mode: "serial" });

const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

async function axeBlocking(page: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page }).setLegacyMode(true).withTags(WCAG_TAGS).analyze();
  return violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
}

/** "Not covered yet: FL, IL, NY, OR · 4 items · $3,497.40" -> the part every surface must share. */
async function noteLine(page: Page, testId: string): Promise<string> {
  const el = page.getByTestId(testId);
  await expect(el).toBeVisible({ timeout: 90_000 });
  return ((await el.innerText()).match(/Not covered yet:[^\n]*/)?.[0] ?? "").replace(/\s+/g, " ").trim();
}

test("after +45 days every surface groups the not-covered items with the same count and amount", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  try {
    await page.request.post("/api/clock", { data: { action: "reset" } });
    await page.goto("/dashboard", { timeout: 120_000 });
    await expect(page.getByTestId("not-covered-note")).toHaveCount(0);

    const moved = await page.request.post("/api/clock", { data: { action: "advance", days: 45 } });
    expect(moved.ok()).toBe(true);

    await page.goto("/dashboard", { timeout: 120_000 });
    const dash = await noteLine(page, "not-covered-note");
    expect(dash).toMatch(/^Not covered yet: .+ · \d+ items? · \$[\d,]+\.\d{2}$/);
    await expect(page.getByTestId("not-covered-note")).toContainText("Rules are not loaded for these states");
    // The headline no longer counts them as states we file in.
    // Order follows exposure (largest first), so match the set, not the order.
    await expect(page.getByTestId("exposure-meta")).toHaveText(
      /3 states we file in \((?=[^)]*CA)(?=[^)]*DE)(?=[^)]*TX)[A-Z, ]+\)/,
    );
    await page.screenshot({ path: `${SHOTS}/dashboard-1440.png`, fullPage: true });

    await page.goto("/items", { timeout: 120_000 });
    expect(await noteLine(page, "items-not-covered")).toBe(dash);
    await page.getByTestId("items-not-covered-toggle").click();
    await expect(page).toHaveURL(/coverage=none/);
    await expect(page.getByTestId("items-not-covered-toggle")).toHaveAttribute("aria-pressed", "true");

    await page.goto("/ledger", { timeout: 120_000 });
    expect(await noteLine(page, "ledger-not-covered")).toBe(dash);
    await expect(page.getByTestId("ledger-closing")).toHaveAttribute("data-reconciles", "true");
    await expect(page.locator("[data-testid^='roll-not-covered-']").first()).toContainText("rules not loaded");

    await page.goto("/forecast", { timeout: 120_000 });
    expect(await noteLine(page, "forecast-not-covered")).toBe(dash);
    await expect(page.getByTestId("forecast-not-covered")).toContainText("not placed in any month");
  } finally {
    await page.request.post("/api/clock", { data: { action: "reset" } });
  }
});

for (const width of WIDTHS) {
  test(`coverage surfaces at ${width}px: axe clean, no horizontal overflow`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    try {
      await page.request.post("/api/clock", { data: { action: "reset" } });
      await page.request.post("/api/clock", { data: { action: "advance", days: 45 } });
      for (const path of ["/dashboard", "/items", "/ledger", "/forecast"]) {
        await page.goto(path, { timeout: 120_000 });
        await expect(page.locator("main")).toBeVisible({ timeout: 90_000 });
        await expect(page.getByTestId(path === "/dashboard" ? "not-covered-note" : `${path.slice(1)}-not-covered`)).toBeVisible({ timeout: 90_000 });
        expect(await overflow(page), `${path} overflows at ${width}`).toBeLessThanOrEqual(1);
        expect(await axeBlocking(page), `${path} axe at ${width}`).toEqual([]);
        if (width !== 1024) await page.screenshot({ path: `${SHOTS}/${path.slice(1)}-${width}.png`, fullPage: true });
      }
    } finally {
      await page.request.post("/api/clock", { data: { action: "reset" } });
    }
  });
}
