/**
 * Dogfood round 5 polish (R5-15, R5-18, Money Map label overlap at 375). Read-only.
 *   E2E_PORT=3941 E2E_DIR_SUFFIX=r5-polish CI=1 pnpm exec playwright test tests/e2e/ui-r5-polish.spec.ts --project ui
 */
import { mkdirSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "playwright/test";

const DISCLAIMER = "Prototype. Not legal advice. Confirm filings with a qualified professional.";
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const SHOTS = ".data/shots/r5-polish";
const WIDTHS = [375, 1024, 1440] as const;

test.use({ reducedMotion: "reduce" });
test.beforeAll(() => mkdirSync(SHOTS, { recursive: true }));
test.beforeEach(({}, info) => test.skip(info.project.name !== "ui", "runs in the ui project only"));
test.describe.configure({ timeout: 180_000 });

async function open(page: Page, path: string, width: number, ready: string) {
  await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
  await page.goto(path, { timeout: 90_000 });
  await expect(page.locator(ready).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(DISCLAIMER)).toBeVisible();
}

async function axeBlocking(page: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page }).setLegacyMode(true).withTags(WCAG_TAGS).analyze();
  return violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
}

const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

for (const width of WIDTHS) {
  test(`Money Map labels stay clear of the heading at ${width}px`, async ({ page }) => {
    await open(page, "/dashboard", width, "[data-testid^=state-tile-]");
    const heading = page.getByRole("heading", { name: /Money map/ });
    await heading.scrollIntoViewIfNeeded();
    const h = await heading.boundingBox();
    const tiles = page.locator("[data-testid^=state-tile-]");
    for (let i = 0; i < (await tiles.count()); i++) {
      const b = await tiles.nth(i).boundingBox();
      if (!b || !h) continue;
      const overlaps = b.x < h.x + h.width && b.x + b.width > h.x && b.y < h.y + h.height && b.y + b.height > h.y;
      expect(overlaps, `tile ${i} overlaps the Money Map heading`).toBe(false);
    }
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    expect(await axeBlocking(page)).toEqual([]);
    await page.locator("[data-map-root]").first().screenshot({ path: `${SHOTS}/money-map-${width}.png` });
  });

  test(`Approvals rows do not overlap and dates are demo dates at ${width}px`, async ({ page }) => {
    await open(page, "/approvals", width, "[data-group]");
    for (const row of await page.locator("button[data-group]").all()) {
      const seq = row.locator('[data-testid="row-sequence"] > span');
      const aside = row.locator("span.shrink-0.flex-col");
      if ((await seq.count()) === 0 || (await aside.count()) === 0) continue;
      const a = await aside.first().boundingBox();
      for (const s of await seq.all()) {
        const b = await s.boundingBox();
        if (!b || !a) continue;
        const overlaps = b.x < a.x + a.width && b.x + b.width > a.x && b.y < a.y + a.height && b.y + b.height > a.y;
        expect(overlaps).toBe(false);
      }
    }
    const body = await page.locator("body").innerText();
    expect(body).not.toMatch(/\bon \d{4}-\d{2}-\d{2}\b/);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    expect(await axeBlocking(page)).toEqual([]);
    await page.screenshot({ path: `${SHOTS}/approvals-${width}.png` });
  });
}

test("Reports uses singular grammar for one earlier report", async ({ page }) => {
  await open(page, "/reports", 1024, "main");
  expect(await page.locator("body").innerText()).not.toMatch(/1 earlier report for \w+ are/);
});
