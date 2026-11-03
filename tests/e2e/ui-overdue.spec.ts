/**
 * R2-02: overdue obligations are visible. Items (filter + row chip), Dashboard (panel ahead of the total and of
 * upcoming deadlines), Forecast (panel) and the calendar export (OVERDUE events), all from the one shared overdue
 * function (src/lib/overdue.ts). Seed data is never edited: the spec advances the demo clock one year, which makes
 * deterministic CA/DE/TX dates pass, then resets it in afterAll so other "ui" specs see the anchor date again.
 *
 * Also: axe serious/critical clean and no horizontal overflow at 375/1024/1440; screenshots to .data/shots/overdue-*.png.
 */
import { mkdirSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext, type Page } from "playwright/test";

const DISCLAIMER = "Prototype. Not legal advice. Confirm filings with a qualified professional.";
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const WIDTHS = [375, 1024, 1440] as const;
const SHOT_DIR = ".data/shots";
const ADVANCE_DAYS = 365;

async function clock(request: APIRequestContext, body: object) {
  const r = await request.post("/api/clock", { data: body });
  expect(r.status(), await r.text()).toBeLessThan(300);
}

const PAGES = [
  { name: "dashboard", path: "/dashboard", ready: (p: Page) => p.getByRole("region", { name: "Total exposure" }) },
  { name: "items", path: "/items?overdue=1", ready: (p: Page) => p.locator("tbody tr[data-row-id]").first() },
  { name: "forecast", path: "/forecast", ready: (p: Page) => p.getByTestId("forecast-window") },
] as const;

async function open(page: Page, s: (typeof PAGES)[number]) {
  await page.goto(s.path);
  await expect(s.ready(page)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(DISCLAIMER)).toBeVisible();
}

test.describe.configure({ mode: "serial" });

test("at the anchor date: the overdue filter count matches the overdue rows (seed data unchanged)", async ({ page }) => {
  await page.goto("/items");
  await expect(page.locator("tbody tr[data-row-id]").first()).toBeVisible({ timeout: 30_000 });
  const filter = page.getByTestId("filter-overdue");
  await expect(filter).toHaveAttribute("aria-pressed", "false");
  const n = Number((await filter.textContent())?.replace(/\D/g, ""));
  await filter.click();
  await expect(filter).toHaveAttribute("aria-pressed", "true");
  await expect(page).toHaveURL(/overdue=true|overdue=1/);
  if (n === 0) {
    await expect(page.getByText("No items match these filters")).toBeVisible();
  } else {
    await expect(page.locator("tbody tr[data-row-id]")).toHaveCount(n);
  }
});

test.describe("after advancing the demo clock one year", () => {
  test.beforeAll(async ({ request }) => {
    await clock(request, { action: "advance", days: ADVANCE_DAYS });
  });
  test.afterAll(async ({ request }) => {
    await clock(request, { action: "reset" });
  });

  test("items: Overdue filter lists only overdue rows, each with a pink chip and its missed date", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, PAGES[1]);
    const rows = page.locator("tbody tr[data-row-id]");
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);
    await expect(page.getByTestId("filter-overdue")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("filter-overdue")).toContainText(String(count));
    await expect(rows.locator("[data-testid=overdue-chip]:visible")).toHaveCount(count);
    await expect(rows.first()).toContainText(/Overdue \d+(d|mo|y)/);
    await expect(page.getByTestId("items-footer")).toContainText(`${count} ${count === 1 ? "item" : "items"}`);
  });

  test("dashboard: overdue panel comes before the total and the deadlines, and leads Needs you", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, PAGES[0]);
    const panel = page.getByTestId("overdue-panel");
    await expect(panel).toBeVisible();
    const n = Number(await panel.getByTestId("overdue-count").textContent());
    expect(n).toBeGreaterThan(0);
    await expect(panel.getByTestId("overdue-amount")).toHaveText(/^\$[\d,]+\.\d{2}$/);
    await expect(panel).toContainText(/days? late/);
    // Overdue is above the exposure total in the reading order.
    const before = await page.evaluate(() => {
      const a = document.querySelector("[data-testid=overdue-panel]");
      const b = document.querySelector("section[aria-label='Total exposure']");
      return Boolean(a && b && a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    expect(before).toBe(true);
    await expect(page.getByTestId("needs-you")).toContainText(n === 1 ? "item overdue" : "items overdue");
    await panel.getByRole("link", { name: /overdue items|Open in Items/ }).click();
    await expect(page).toHaveURL(/\/items\?overdue=1/);
    await expect(page.locator("tbody tr[data-row-id]")).toHaveCount(n);
  });

  test("forecast and calendar export include overdue obligations, marked OVERDUE", async ({ page, request }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, PAGES[2]);
    const panel = page.getByTestId("overdue-panel");
    await expect(panel).toBeVisible();
    await expect(panel).toContainText(/past a filing deadline/);
    const ics = await request.get("/api/calendar.ics");
    expect(ics.status()).toBe(200);
    const body = (await ics.text()).replace(/\r\n[ \t]/g, "");
    expect(body).toMatch(/SUMMARY:OVERDUE: [A-Z]{2} /);
    expect(body).toContain("CATEGORIES:Unclaimed property,");
  });

  test("reports flags the late filing on the state tab and in the report; approvals still loads", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/reports?state=TX");
    await expect(page.getByTestId("report-detail")).toBeVisible({ timeout: 30_000 });
    const note = page.getByTestId("report-overdue");
    await expect(note).toBeVisible();
    await expect(note).toContainText(/TX filing is overdue/);
    await expect(note).toContainText(/Report due Jul 1, 2026, \d+ days late/);
    await expect(page.getByTestId("reports-tab-overdue-TX")).toContainText(/\d+ overdue/);
    await page.goto("/approvals");
    await expect(page.locator("[data-key]").first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(DISCLAIMER)).toBeVisible();
  });

  for (const width of WIDTHS) {
    for (const s of PAGES) {
      test(`${s.name} @${width}px: no horizontal overflow, axe serious/critical clean`, async ({ page }) => {
        await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
        await open(page, s);
        await page.evaluate(() => document.fonts.ready);
        if (s.name !== "items") await expect(page.getByTestId("overdue-panel")).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
        const { violations } = await new AxeBuilder({ page }).setLegacyMode(true).withTags(WCAG_TAGS).analyze();
        const blocking = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
        expect(blocking.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
        if (width !== 1024) {
          mkdirSync(SHOT_DIR, { recursive: true });
          await page.waitForLoadState("networkidle").catch(() => undefined);
          await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));
          await page.screenshot({ path: `${SHOT_DIR}/overdue-${s.name}-${width}.png`, fullPage: width === 375 ? false : true });
        }
      });
    }
  }
});
