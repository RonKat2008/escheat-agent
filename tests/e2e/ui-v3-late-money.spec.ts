/**
 * "Lead with late money" (dogfood round 3, opportunity #2). On a fresh seed the TX item is past its report due date:
 *  - the dashboard Overdue band shows the late amount and the interest it is accruing, and that interest equals the
 *    Audit-interest card's TX figure (both from the rules engine; the band never invents a rate);
 *  - "Generate & file catch-up report" deep-links to the TX report, which generates once and stops at Approve with a
 *    "Catch-up filing: N late items, $X" banner;
 *  - nothing is filed and the filing agent cannot start before a person approves;
 *  - axe serious/critical clean, no horizontal overflow at 375/1024/1440.
 * Writes .data/shots/late-money-{dashboard-1440,dashboard-375,reports-1440}.png. Generates (never approves or files) the
 * TX report on this server's database.
 */
import { mkdirSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "playwright/test";

const DISCLAIMER = "Prototype. Not legal advice. Confirm filings with a qualified professional.";
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const SHOTS = ".data/shots";
const WIDTHS = [375, 1024, 1440] as const;
const USD = /\$[\d,]+\.\d{2}/;

async function openDashboard(page: Page, width = 1440) {
  await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
  await page.goto("/dashboard", { timeout: 90_000 });
  await expect(page.getByRole("region", { name: "Total exposure" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(DISCLAIMER)).toBeVisible();
}

async function axeBlocking(page: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page }).setLegacyMode(true).withTags(WCAG_TAGS).analyze();
  return violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
}

const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** The Audit-interest card's TX interest, as displayed. */
async function cardInterest(page: Page, state: string): Promise<string> {
  const card = page.locator("section").filter({ has: page.getByRole("heading", { name: "Audit-interest exposure" }) });
  const row = card.locator("tbody tr").filter({ has: page.locator("td", { hasText: new RegExp(`^${state}$`) }) });
  await expect(row).toHaveCount(1);
  const text = (await row.locator("td").last().innerText()).match(USD)?.[0];
  expect(text, `${state} interest on the Audit-interest card`).toBeTruthy();
  return text!;
}

test.describe.configure({ mode: "serial", timeout: 180_000 });
test.beforeAll(() => mkdirSync(SHOTS, { recursive: true }));

test("the Overdue band leads with the late amount and the interest accruing, matching the Audit-interest card", async ({ page }) => {
  await openDashboard(page);
  const band = page.getByTestId("overdue-panel");
  await expect(band).toBeVisible();
  const late = band.getByTestId("late-money");
  await expect(late).toBeVisible();
  const lateAmount = (await late.getByTestId("late-amount").innerText()).trim();
  expect(lateAmount).toMatch(/^\$[\d,]+\.\d{2}$/);
  // The late amount is the overdue total the band already reports.
  await expect(band.getByTestId("overdue-amount")).toHaveText(lateAmount);
  await expect(late).toContainText("late");

  const interest = (await late.getByTestId("late-interest").innerText()).trim();
  expect(interest).toMatch(/^\$[\d,]+\.\d{2}$/);
  await expect(late).toContainText(/interest accruing \(TX\)/);
  // The TX rule value is unverified on the seed, so the badge stays.
  await expect(late.getByTestId("unverified-badge")).toBeVisible();
  // Same deterministic engine call as the card: the figures agree to the cent.
  expect(interest).toBe(await cardInterest(page, "TX"));

  // One primary action in the band, and Needs you keeps its single primary (asserted by ui-v3-dashboard / ui-surfaces).
  const btn = band.getByTestId("catch-up-btn");
  await expect(btn).toHaveText(/Generate & file catch-up report/);
  await expect(btn).toHaveAttribute("href", "/reports?state=TX&catchup=1");
  await page.screenshot({ path: `${SHOTS}/late-money-dashboard-1440.png`, fullPage: true });
});

test("dashboard: axe clean and no horizontal overflow at 375/1024/1440", async ({ page }) => {
  for (const width of WIDTHS) {
    await openDashboard(page, width);
    await expect(page.getByTestId("late-money")).toBeVisible();
    expect(await overflow(page), `overflow @${width}`).toBeLessThanOrEqual(0);
    if (width === 375) {
      await page.getByTestId("catch-up-btn").scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${SHOTS}/late-money-dashboard-375.png`, fullPage: true });
    }
    if (width !== 1024) expect(await axeBlocking(page), `axe @${width}`).toEqual([]);
  }
});

test("the button lands on the TX report with the catch-up banner, stopped at Approve; nothing is filed", async ({ page }) => {
  await openDashboard(page);
  const lateAmount = (await page.getByTestId("late-amount").innerText()).trim();
  const interest = (await page.getByTestId("late-interest").innerText()).trim();
  const filingCalls: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && /\/api\/(agents\/file|reports\/[^/]+\/approve)/.test(r.url())) filingCalls.push(r.url());
  });

  await page.getByTestId("catch-up-btn").click();
  await expect(page).toHaveURL(/\/reports\?state=TX&catchup=1$/, { timeout: 60_000 });
  await expect(page.getByText(DISCLAIMER)).toBeVisible();
  await expect(page.getByRole("heading", { name: "TX unclaimed property report" })).toBeVisible({ timeout: 60_000 });

  const banner = page.getByTestId("catch-up-banner");
  await expect(banner).toBeVisible();
  await expect(banner).toContainText(/Catch-up filing: \d+ late items?, \$[\d,]+\.\d{2}/);
  // On the seed every late item is a TX item, so the banner's late money is the dashboard's.
  await expect(banner).toContainText(lateAmount);
  await expect(banner.getByTestId("catch-up-interest")).toHaveText(interest);
  await expect(banner.getByTestId("unverified-badge")).toBeVisible();

  // The deep link generated the report (the existing POST /api/reports) and stopped at the human gate.
  const approve = page.getByTestId("approve-step");
  await expect(approve).toBeVisible({ timeout: 90_000 });
  await expect(approve.getByTestId("approve-report-btn")).toBeVisible();
  await expect(banner.getByTestId("catch-up-next")).toContainText("Nothing is filed until you do");

  // Nothing filed and the filing agent cannot start before Approve.
  await expect(page.getByTestId("filing-panel")).toBeVisible();
  await expect(page.getByTestId("filing-ready")).toContainText("Approve the submission above first");
  await expect(page.getByTestId("run-filing-btn")).toHaveCount(0);
  await expect(page.getByTestId("filing-confirmed")).toHaveCount(0);
  await expect(page.getByTestId("confirmation-number")).toHaveCount(0);
  expect(filingCalls, "no approve or filing call was made").toEqual([]);

  // Reloading the deep link does not generate again: the report exists, the page still waits at Approve.
  const generated: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && /\/api\/reports$/.test(r.url())) generated.push(r.url());
  });
  await page.reload();
  await expect(page.getByTestId("approve-step")).toBeVisible({ timeout: 60_000 });
  await page.waitForLoadState("networkidle").catch(() => undefined);
  expect(generated).toEqual([]);
  await expect(page.getByTestId("filing-confirmed")).toHaveCount(0);

  await page.screenshot({ path: `${SHOTS}/late-money-reports-1440.png`, fullPage: true });
  expect(await axeBlocking(page)).toEqual([]);
});

test("reports in catch-up mode: no horizontal overflow at 375/1024/1440, axe clean at 375", async ({ page }) => {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
    await page.goto("/reports?state=TX&catchup=1", { timeout: 90_000 });
    await expect(page.getByTestId("catch-up-banner")).toBeVisible({ timeout: 30_000 });
    expect(await overflow(page), `overflow @${width}`).toBeLessThanOrEqual(0);
    if (width === 375) expect(await axeBlocking(page), "axe @375").toEqual([]);
  }
});
