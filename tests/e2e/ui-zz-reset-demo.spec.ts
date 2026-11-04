/**
 * In-app "Reset demo data" (Settings and the demo clock popover). Named ui-zz so it runs last in the ui group: it
 * reseeds the whole synthetic database. Dirties the demo (moves the clock), resets through the confirm dialog, and
 * checks the dashboard is back at the seed numbers. Also axe + no overflow + screenshots on the Settings section.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "playwright/test";

const SHOTS = ".data/shots/r6-misc";
const WIDTHS = [375, 1024, 1440] as const;
const DISCLAIMER = "Prototype. Not legal advice. Confirm filings with a qualified professional.";

async function dirty(page: Page) {
  const res = await page.request.post("/api/clock", { data: { action: "advance", days: 90 } });
  expect(res.ok()).toBe(true);
}

async function expectSeedDashboard(page: Page) {
  await page.goto("/dashboard");
  const hero = page.getByRole("region", { name: "Total exposure" });
  await expect(hero.getByTestId("exposure-meta")).toContainText("47");
  await expect(hero).toContainText("$61,915.00");
  await expect(page.getByTestId("demo-date")).toHaveAttribute("data-date", "2026-11-01");
}

test("Settings: cancel keeps the data; confirm reseeds to 47 items and $61,915.00", async ({ page }) => {
  await dirty(page);
  await page.goto("/settings/integrations");
  await expect(page.getByTestId("demo-date")).not.toHaveAttribute("data-date", "2026-11-01");
  const open = page.getByTestId("reset-demo-open");
  await expect(open).toBeEnabled();
  await open.click();
  const dialog = page.getByRole("dialog", { name: "Reset demo data?" });
  await expect(dialog).toContainText("cannot be undone");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await page.reload();
  await expect(page.getByTestId("demo-date")).not.toHaveAttribute("data-date", "2026-11-01");

  await page.getByTestId("reset-demo-open").click();
  await page.getByTestId("reset-demo-confirm").click();
  await expect(page.getByText("Demo data reset")).toBeVisible({ timeout: 60_000 });
  await expectSeedDashboard(page);
});

test("the demo clock popover offers the same reset", async ({ page }) => {
  await dirty(page);
  await page.goto("/dashboard");
  await page.getByRole("button", { name: /^Demo clock/ }).click();
  const open = page.getByTestId("reset-demo-open");
  await expect(open).toBeEnabled();
  await open.click();
  await page.getByTestId("reset-demo-confirm").click();
  await expect(page.getByText("Demo data reset")).toBeVisible({ timeout: 60_000 });
  await expectSeedDashboard(page);
});

test("the API refuses a reset without confirmation", async ({ page }) => {
  const res = await page.request.post("/api/demo/reset", { data: {} });
  expect(res.status()).toBe(400);
  const avail = await (await page.request.get("/api/demo/reset")).json();
  expect(avail).toEqual({ available: true, reason: null });
});

for (const width of WIDTHS) {
  test(`Settings @${width}px: no overflow, axe clean, dialog too`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
    await page.goto("/settings/integrations");
    await expect(page.getByTestId("reset-demo-open")).toBeEnabled();
    await expect(page.getByText(DISCLAIMER)).toBeVisible();
    await page.getByTestId("reset-demo").scrollIntoViewIfNeeded();
    if (width !== 1024) await page.screenshot({ path: `${SHOTS}/settings-${width}.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    await page.getByTestId("reset-demo-open").click();
    const dialog = page.getByRole("dialog", { name: "Reset demo data?" });
    await expect(dialog).toBeVisible();
    if (width !== 1024) await page.screenshot({ path: `${SHOTS}/confirm-${width}.png` });
    const results = await new AxeBuilder({ page }).setLegacyMode(true).analyze();
    expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
    await dialog.getByRole("button", { name: "Cancel" }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });
}
