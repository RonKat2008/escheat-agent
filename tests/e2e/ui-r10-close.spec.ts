/**
 * R10-01: "Close <Month>" on /ledger. Closing is typed-name approved and irreversible; afterwards the page says
 * "Closed Nov 2026 · pack 3f9a… · chain #N" and the month's pack downloads byte-identical. Axe clean and no horizontal
 * overflow at 375/1024/1440. Screenshots to .data/shots/r10close/. Synthetic data; nothing is posted or sent.
 */
import { mkdirSync, readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "playwright/test";

const DISCLAIMER = "Prototype. Not legal advice. Confirm filings with a qualified professional.";
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const SHOTS = ".data/shots/r10close";
const WIDTHS = [375, 1024, 1440] as const;

async function open(page: Page, width: number) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
  await page.goto("/ledger", { timeout: 90_000 });
  await expect(page.getByTestId("close-pack-button")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(DISCLAIMER).first()).toBeVisible();
  await page.waitForLoadState("networkidle").catch(() => undefined);
}

async function noOverflow(page: Page) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over).toBeLessThanOrEqual(0);
}

async function axe(page: Page) {
  const res = await new AxeBuilder({ page }).setLegacyMode(true).withTags(WCAG_TAGS).analyze();
  expect(res.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
}

async function downloadPack(page: Page, month: string): Promise<Buffer> {
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("close-pack-button").click()]);
  expect(download.suggestedFilename()).toBe(`escheat-close-pack-${month}.zip`);
  return readFileSync(await download.path());
}

test.describe.configure({ mode: "serial", timeout: 180_000 });
test.beforeAll(() => mkdirSync(SHOTS, { recursive: true }));

test("an open month offers Close, the panel is approval-gated, and layout holds at three widths", async ({ page }) => {
  for (const w of WIDTHS) {
    await open(page, w);
    const month = await page.getByTestId("close-pack-month").inputValue();
    await expect(page.getByTestId("close-status")).toHaveCount(0);
    await page.getByTestId("close-month-open").click();
    await expect(page.getByTestId("close-month-panel")).toBeVisible();
    // the irreversible step needs a typed name
    await expect(page.getByTestId("close-month-confirm")).toBeDisabled();
    await noOverflow(page);
    await axe(page);
    await page.screenshot({ path: `${SHOTS}/open-${month}-${w}.png`, fullPage: false });
  }
});

test("Close Nov 2026 freezes the month: status line, chain number, byte-identical re-download", async ({ page }) => {
  await open(page, 1440);
  const month = await page.getByTestId("close-pack-month").inputValue();
  await page.getByTestId("close-month-open").click();
  await page.getByLabel("Approving as").fill("Dana Reviewer");
  await page.getByTestId("close-month-confirm").click();
  const status = page.getByTestId("close-status");
  await expect(status).toBeVisible({ timeout: 90_000 });
  await expect(status).toHaveText(/Closed .+ \d{4} · pack [0-9a-f]{4}… · chain #\d+/);
  await expect(page.getByTestId("close-month-open")).toHaveCount(0);

  const first = await downloadPack(page, month);
  const second = await downloadPack(page, month);
  expect(first.length).toBeGreaterThan(1000);
  expect(first.equals(second)).toBe(true);

  for (const w of WIDTHS) {
    await open(page, w);
    await expect(page.getByTestId("close-status")).toBeVisible();
    await noOverflow(page);
    await axe(page);
    await page.screenshot({ path: `${SHOTS}/closed-${month}-${w}.png`, fullPage: false });
  }
});
