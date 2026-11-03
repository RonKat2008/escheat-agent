/**
 * Dogfood round 2, findings R2-05/R2-06/R2-07 ("ui" group): a payee merge reaches /activity and the CSV, activity rows
 * name payees instead of UUIDs, runs are one row each with plain-language errors, and (with ESCHEAT_OFFLINE=1) chat
 * replays are labeled and unbilled on /runs. Merges one payee pair in the isolated ui server's database.
 */
import { mkdirSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "playwright/test";

const SHOTS = ".data/shots";
const DISCLAIMER = "Prototype. Not legal advice. Confirm filings with a qualified professional.";
const WIDTHS = [375, 1024, 1440] as const;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

async function axeClean(page: Page) {
  const { violations } = await new AxeBuilder({ page }).setLegacyMode(true).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const blocking = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(blocking.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

test.describe.configure({ mode: "serial", timeout: 120_000 });
test.beforeAll(() => mkdirSync(SHOTS, { recursive: true }));

test("a confirmed payee merge appears in Activity, the Payee filter and the CSV (R2-05)", async ({ page, request }) => {
  await page.goto("/payees");
  // Leave the Bayline pair for the payees spec, which reviews it by name.
  const button = page.getByTestId("review-pair").filter({ hasNotText: "BAYLINE" }).first().getByRole("button", { name: /Review merge/ });
  const dialog = page.getByTestId("payee-change-dialog");
  await expect(async () => {
    await button.click();
    await expect(dialog).toBeVisible({ timeout: 1_500 });
  }).toPass({ timeout: 20_000 });
  await dialog.getByTestId("payee-change-name").fill("Dana R2");
  await dialog.getByTestId("payee-change-confirm").click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });

  await page.goto("/activity?kind=payee");
  const rows = page.getByTestId("activity-entry");
  await expect(rows.first()).toBeVisible();
  await expect(rows.first()).toContainText("Payees merged into");
  await expect(rows.first()).toContainText("Dana R2");
  await page.screenshot({ path: `${SHOTS}/activity-r2-payee-1440.png`, fullPage: true });

  const csv = await request.get("/api/activity.csv?kind=payee");
  expect(csv.ok()).toBe(true);
  const text = await csv.text();
  expect(text).toContain("Payees merged into");
  expect(text).toContain("Dana R2");
});

test("activity rows name payees and checks, not UUIDs, and runs are one row each (R2-06)", async ({ page }) => {
  await page.goto("/activity");
  await expect(page.getByTestId("activity-entry").first()).toBeVisible();
  const body = await page.getByTestId("activity-log").innerText();
  expect(body).not.toMatch(UUID);
  expect(body).not.toMatch(/OfflineCassetteMissing|ESCHEAT_OFFLINE|request hash|ZodError|Failed query/);
  expect(body).not.toMatch(/Agent run started/);
  const runTitles = await page.locator('[data-testid="activity-entry"][data-kind="run"]').allInnerTexts();
  for (const t of runTitles) expect(t).toMatch(/Agent run (completed|failed|skipped \(offline\)|stopped|in progress)/);
  await page.screenshot({ path: `${SHOTS}/activity-r2-log-1440.png`, fullPage: true });
});

test("replayed chat runs are labeled and not billed on /runs (R2-07)", async ({ page }) => {
  test.skip(process.env.ESCHEAT_OFFLINE !== "1", "needs ESCHEAT_OFFLINE=1 cassette replays");
  await page.goto("/chat");
  await page.getByTestId("chat-input").fill("What do we owe in unclaimed property, and where?");
  await page.keyboard.press("Enter");
  // Either a full replay or the clean drift/no-recording message: both are logged as offline replays.
  await expect(page.getByTestId("chat-assistant-message").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Demo data changed since these answers were recorded|no recorded answer|recorded answer/i).or(page.getByTestId("chat-offline-badge")).first()).toBeVisible({ timeout: 30_000 });
  await page.goto("/runs?agent=chat&replays=1");
  await expect(page.getByTestId("replay-label").first()).toHaveText("Replay (offline)");
  const first = page.locator("tbody tr").first();
  await expect(first).toContainText("Not billed");
  await expect(first).not.toContainText("$0.0");
  await page.screenshot({ path: `${SHOTS}/activity-r2-runs-replay-1440.png`, fullPage: true });
});

for (const width of WIDTHS) {
  test(`activity and runs at ${width}px: axe-clean, no horizontal overflow, disclaimer present`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ["/activity", "/runs"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      await expect(page.getByText(DISCLAIMER).first()).toBeVisible();
      expect(await overflow(page)).toBeLessThanOrEqual(0);
      await axeClean(page);
    }
    await page.goto("/activity");
    await page.screenshot({ path: `${SHOTS}/activity-r2-${width}.png` });
  });
}
