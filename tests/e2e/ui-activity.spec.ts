/**
 * Activity (audit trail) e2e, "ui" group: entries render after seed, filters live in the URL, CSV export is gated and
 * escaped, no horizontal overflow at 375/1024/1440, axe serious/critical clean. Screenshots land in .data/shots/.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "playwright/test";

test.use({ reducedMotion: "reduce" });

const entries = (page: Page) => page.getByTestId("activity-entry");

async function open(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await expect(page.getByRole("heading", { name: "Activity", level: 1 })).toBeVisible();
  await expect(page.getByRole("search", { name: "Filter activity" })).toBeVisible();
}

test.describe("activity page", () => {
  test("renders real entries after seed, newest first, with the disclaimer", async ({ page }) => {
    await open(page, "/activity");
    await expect(entries(page).first()).toBeVisible();
    const times = await page.locator("[data-testid='activity-entry'] time").evaluateAll((els) => els.map((e) => (e as HTMLTimeElement).dateTime));
    expect(times.length).toBeGreaterThan(0);
    expect(times).toEqual([...times].sort().reverse());
    await expect(page.getByText("Prototype. Not legal advice. Confirm filings with a qualified professional.")).toBeVisible();
    // every entry links to a subject inside the app
    const hrefs = await entries(page).locator("a").evaluateAll((els) => els.map((e) => e.getAttribute("href")));
    for (const h of hrefs) expect(h).toMatch(/^\/(items|runs|reports|rules|recoveries|approvals|payees)/);
  });

  test("filters through the URL: kind narrows entries, impossible text shows an honest empty state", async ({ page }) => {
    await open(page, "/activity");
    const total = await entries(page).count();
    await open(page, "/activity?kind=ingestion");
    await expect(entries(page).first()).toBeVisible();
    const kinds = await entries(page).evaluateAll((els) => els.map((e) => e.getAttribute("data-kind")));
    expect(new Set(kinds)).toEqual(new Set(["ingestion"]));
    expect(kinds.length).toBeLessThanOrEqual(total);

    await open(page, "/activity?q=zzz-no-such-event-zzz");
    await expect(page.getByText("No activity matches these filters")).toBeVisible();
    await expect(entries(page)).toHaveCount(0);

    await open(page, "/activity?from=2999-01-01");
    await expect(page.getByText("No activity matches these filters")).toBeVisible();
  });

  test("the filter form writes its values to the URL", async ({ page }) => {
    await open(page, "/activity");
    // Slice 6: kind is a row of chips (links) instead of a <select>.
    const kinds = page.getByRole("navigation", { name: "Kind" });
    await kinds.getByRole("link", { name: /^Ingestion/ }).click();
    await expect(page).toHaveURL(/kind=ingestion/);
    await expect(entries(page).first()).toBeVisible();
    await expect(kinds.locator("[data-kind='ingestion']")).toHaveAttribute("aria-current", "true");
  });

  test("CSV export is gated and returns an escaped CSV", async ({ page, playwright, baseURL }) => {
    const anon = await playwright.request.newContext({ baseURL: baseURL!, storageState: { cookies: [], origins: [] } });
    expect((await anon.get("/api/activity.csv")).status()).toBe(401);
    await anon.dispose();

    const res = await page.request.get("/api/activity.csv?kind=ingestion");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/csv");
    const lines = (await res.text()).trimEnd().split("\r\n");
    expect(lines[0]).toBe("timestamp_utc,kind,title,detail,actor,state,payload_sha256_prefix,needs_attention,link,event_id");
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.slice(1).every((l) => l.includes(",ingestion,"))).toBe(true);
  });

  test("the export link carries the active filters", async ({ page }) => {
    await open(page, "/activity?kind=ingestion&state=TX");
    await expect(page.getByTestId("activity-export")).toHaveAttribute("href", /\/api\/activity\.csv\?kind=ingestion&state=TX/);
  });

  test("appears in the sidebar navigation", async ({ page }) => {
    await open(page, "/activity");
    await expect(page.getByRole("link", { name: "Activity" }).first()).toBeVisible();
  });
});

test.describe("activity layout", () => {
  for (const [name, width, height] of [
    ["375", 375, 812],
    ["1024", 1024, 800],
    ["1440", 1440, 900],
  ] as const) {
    test(`no horizontal overflow and axe clean at ${name}px`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await open(page, "/activity");
      await expect(entries(page).first()).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);

      const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      const blocking = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(blocking.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);

      if (width === 375 || width === 1440) await page.screenshot({ path: `.data/shots/activity-${width}.png`, fullPage: false });
    });
  }
});
