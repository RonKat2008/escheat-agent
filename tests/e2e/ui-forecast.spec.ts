import AxeBuilder from "@axe-core/playwright";
import { expect, request as playwrightRequest, test, type Page } from "playwright/test";

/**
 * /forecast (liability forecast + deadline calendar) and GET /api/calendar.ics. Runs in the passcode-gated "ui"
 * group. Deterministic waits only: elements and URL, with toPass where hydration can race a click.
 */
const WIDTHS = [375, 1024, 1440] as const;
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const DISCLAIMER = "Prototype. Not legal advice. Confirm filings with a qualified professional.";

test.use({ reducedMotion: "reduce" });

async function openForecast(page: Page, query = "") {
  await page.goto(`/forecast${query}`);
  await expect(page.getByRole("heading", { name: "Forecast", level: 1 })).toBeVisible();
  await expect(page.getByTestId("forecast-table")).toBeVisible({ timeout: 30_000 });
  // recharts measures its container on the client; wait until the bars exist.
  await expect(page.getByTestId("forecast-chart").locator(".recharts-bar-rectangle").first()).toBeVisible({ timeout: 15_000 });
}

test.describe("forecast page", () => {
  test("renders stats, chart, month table, the UNKNOWN bucket and the disclaimer", async ({ page }) => {
    await openForecast(page);
    await expect(page.getByTestId("forecast-window")).toContainText("Nov 1, 2026");
    await expect(page.getByTestId("forecast-stats")).toContainText("Becoming presumed abandoned");
    await expect(page.getByTestId("forecast-chart")).toHaveAttribute("aria-label", /over 18 months/);
    await expect(page.getByTestId("forecast-table").locator("tbody")).not.toHaveCount(0);
    await expect(page.getByTestId("unknown-bucket")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Unknown, rule missing" })).toBeVisible();
    await expect(page.locator("footer")).toContainText(DISCLAIMER);
    await expect(page.getByRole("link", { name: "Forecast" }).first()).toBeVisible();
  });

  test("filters live in the URL and narrow the table", async ({ page }) => {
    await openForecast(page);
    const stateGroup = page.getByTestId("filter-state");
    await expect(async () => {
      await stateGroup.getByRole("button", { name: "TX", exact: true }).click();
      await expect(page).toHaveURL(/[?&]state=TX/, { timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
    await expect(stateGroup.getByRole("button", { name: "TX", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(async () => {
      const states = await page.getByTestId("forecast-table").locator("tbody tr td:first-of-type").allInnerTexts();
      expect(states.length).toBeGreaterThan(0);
      expect(states.every((s) => s.trim().startsWith("TX"))).toBe(true);
    }).toPass({ timeout: 20_000 });
    await expect(page.getByTestId("add-to-calendar")).toHaveAttribute("href", "/api/calendar.ics?state=TX&horizon=18");

    await page.getByTestId("filter-horizon").getByRole("button", { name: "6 mo" }).click();
    await expect(page).toHaveURL(/horizon=6/);
    await expect(page.getByTestId("forecast-chart")).toHaveAttribute("aria-label", /6 months/);
  });

  for (const width of WIDTHS) {
    test(`no horizontal overflow and axe serious/critical clean at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await openForecast(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
      const { violations } = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
      const blocking = violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.help}`);
      expect(blocking, `forecast @ ${width}px: serious/critical axe violations`).toEqual([]);
    });
  }
});

test.describe("calendar feed", () => {
  test("the dashboard offers Add to calendar", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByTestId("add-to-calendar")).toHaveAttribute("href", "/api/calendar.ics");
  });

  test("GET /api/calendar.ics serves RFC 5545 with CRLF to a signed-in session and refuses without one", async ({ page, baseURL }) => {
    await page.goto("/forecast");
    const res = await page.request.get("/api/calendar.ics");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/calendar");
    const body = await res.text();
    expect(body.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
    expect(body.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(body.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
    expect(body).toContain("BEGIN:VEVENT");
    expect(body.split("\r\n").every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);

    const anonymous = await playwrightRequest.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
    try {
      expect((await anonymous.get("/api/calendar.ics")).status()).toBe(401);
    } finally {
      await anonymous.dispose();
    }
  });
});
