/**
 * Round 10 polish: Money Map shows uncovered states as ONE dashed "Not covered yet" group (R10-02) and "No rules loaded"
 * rather than UNVERIFIED (R10-05); ledger journal at 375 says to scroll sideways (R10-04). Axe + no horizontal overflow.
 *   E2E_PORT=3995 E2E_DIR_SUFFIX=r10polish CI=1 pnpm exec playwright test tests/e2e/ui-r10-polish.spec.ts --project ui --workers=1
 */
import { mkdirSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "playwright/test";

const SHOTS = ".data/shots/r10polish";
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const UNCOVERED = ["IL", "FL", "NY", "OR"];

test.use({ reducedMotion: "reduce" });
test.beforeEach(({}, info) => test.skip(info.project.name !== "ui", "runs in the ui project only"));
test.describe.configure({ mode: "serial", timeout: 180_000 });
test.beforeAll(() => mkdirSync(SHOTS, { recursive: true }));
test.afterAll(async ({ request }) => {
  await request.post("/api/clock", { data: { action: "reset" } });
});

const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
async function axeBlocking(page: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page }).setLegacyMode(true).withTags(WCAG_TAGS).analyze();
  return violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
}

async function openMap(page: Page, width: number) {
  await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
  await page.goto("/dashboard", { timeout: 90_000 });
  await expect(page.getByTestId("map-not-covered")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator("[data-map-root][data-settled=true]").first()).toBeAttached({ timeout: 30_000 });
  await expect(page.locator("[data-map-col]").first()).toBeVisible({ timeout: 30_000 });
  await page.waitForLoadState("networkidle").catch(() => undefined);
}

for (const width of [375, 1440]) {
  test(`Money Map at ${width}: uncovered states are one dashed group, labels do not overlap`, async ({ page }) => {
    await page.request.post("/api/clock", { data: { action: "reset" } });
    const adv = await page.request.post("/api/clock", { data: { action: "advance", days: 45 } });
    expect(adv.ok()).toBe(true);
    await openMap(page, width);

    const group = page.getByTestId("map-not-covered");
    await expect(group).toContainText("Not covered yet");
    await expect(group.getByTestId("map-not-covered-total")).toContainText(/4 states/);
    await expect(group.getByTestId("not-covered-chip")).toHaveText(/No rules loaded/i);
    for (const s of UNCOVERED) await expect(group.getByTestId(`state-tile-${s}`)).toBeVisible();
    // No UNVERIFIED chip on a state with no rules file.
    await expect(group.getByText("UNVERIFIED")).toHaveCount(0);

    // Every label on the map (covered columns) and every uncovered link: no two bounding boxes intersect.
    const boxes = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>("[data-map-col], [data-testid=map-not-covered] a")).map((el) => {
        const r = el.getBoundingClientRect();
        return { id: el.getAttribute("data-testid") ?? "", x: r.x, y: r.y, w: r.width, h: r.height };
      }),
    );
    expect(boxes.length).toBeGreaterThanOrEqual(UNCOVERED.length + 1);
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!;
        const b = boxes[j]!;
        const hit = a.x < b.x + b.w - 1 && b.x < a.x + a.w - 1 && a.y < b.y + b.h - 1 && b.y < a.y + a.h - 1;
        expect(hit, `${a.id} overlaps ${b.id}`).toBe(false);
      }
    }
    // Inside the viewport horizontally.
    for (const b of boxes) {
      expect(b.x).toBeGreaterThanOrEqual(-1);
      expect(b.x + b.w).toBeLessThanOrEqual(width + 1);
    }
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    expect(await axeBlocking(page)).toEqual([]);
    await page.getByTestId("map-not-covered").scrollIntoViewIfNeeded();
    await page.locator("[data-map-root]").screenshot({ path: `${SHOTS}/moneymap-${width}.png` });
  });
}

test("Ledger journal at 375: a scroll-sideways cue is shown and the table scrolls", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/ledger", { timeout: 90_000 });
  const tx = page.locator('[data-testid="je-state"]').first();
  await expect(tx).toBeVisible({ timeout: 60_000 });
  await expect(tx.getByTestId("journal-scroll-cue")).toBeVisible();
  await expect(tx.getByTestId("journal-scroll-cue")).toContainText("Scroll sideways");
  const scroller = tx.locator(".es-scroll-x");
  expect(await scroller.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  expect(await axeBlocking(page)).toEqual([]);
  await tx.screenshot({ path: `${SHOTS}/ledger-journal-375.png` });
  // 1440 has no cue.
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(tx.getByTestId("journal-scroll-cue")).toBeHidden();
});
