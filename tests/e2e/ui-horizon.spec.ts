/**
 * Pre-stale Horizon (/horizon) + GET /api/horizon.csv, "ui" group. Read-only feature: nothing here mutates state, so it
 * is safe in the shared ui DB. Counts are compared against each other (query count on the page, dots, worklist rows,
 * CSV rows), never against a hard-coded seed number. Screenshots land in .data/shots/r8-horizon/.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "playwright/test";

const WIDTHS = [375, 1024, 1440] as const;
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const DISCLAIMER = "Prototype. Not legal advice. Confirm filings with a qualified professional.";
const SHOTS = ".data/shots/r8-horizon";

async function openHorizon(page: Page): Promise<number> {
  await page.goto("/horizon");
  await expect(page.getByRole("heading", { name: "Pre-stale Horizon", level: 1 })).toBeVisible();
  const root = page.getByTestId("horizon");
  await expect(root).toBeVisible({ timeout: 30_000 });
  return Number(await root.getAttribute("data-count"));
}

async function clockToday(page: Page): Promise<string> {
  const res = await page.request.get("/api/clock");
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { today: string; offsetDays: number };
  return `${body.today}|${body.offsetDays}`;
}

test.describe("pre-stale horizon (reduced motion: static fallback)", () => {
  test.use({ reducedMotion: "reduce" });

  test("dots, worklist rows and buckets all agree with the query; static radar; disclaimer", async ({ page }) => {
    const hydration: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error" && /hydrat/i.test(m.text())) hydration.push(m.text().slice(0, 200));
    });
    const count = await openHorizon(page);
    await expect(page.locator(".hr-dot[tabindex='0']")).toHaveCount(1);
    expect(hydration, "no hydration mismatch on /horizon").toEqual([]);
    expect(count).toBeGreaterThan(0);
    await expect(page.getByTestId("horizon-dot")).toHaveCount(count);
    await expect(page.getByTestId("worklist-row")).toHaveCount(count);

    const total = Number(await page.getByTestId("horizon").getAttribute("data-total-cents"));
    const bucketCents = await page.getByTestId("horizon-bucket").evaluateAll((els) => els.map((e) => Number(e.getAttribute("data-cents"))));
    const bucketCounts = await page.getByTestId("horizon-bucket").evaluateAll((els) => els.map((e) => Number(e.getAttribute("data-count"))));
    expect(bucketCents).toHaveLength(4);
    expect(bucketCents.reduce((a, b) => a + b, 0)).toBe(total);
    expect(bucketCounts.reduce((a, b) => a + b, 0)).toBe(count);

    // Reduced motion: the flat, motionless fallback (no tilt, no sweep).
    const radar = page.getByTestId("horizon-radar");
    await expect(radar).toHaveAttribute("data-tier", "static");
    await expect(radar.locator(".hr-sweep")).toHaveCount(0);
    await expect(page.locator(".hr-dot[data-anim='true']")).toHaveCount(0);

    // Rings: stale line is labelled business policy; state points carry UNVERIFIED.
    await expect(radar.locator("[data-ring='stale']").filter({ hasText: "business policy, not law" })).toHaveCount(1);
    await expect(radar.getByTestId("ring-unverified").first()).toBeVisible();
    await expect(page.locator("footer")).toContainText(DISCLAIMER);
  });

  test("CSV export is gated and has one row per worklist item", async ({ page, playwright, baseURL }) => {
    const anon = await playwright.request.newContext({ baseURL: baseURL!, storageState: { cookies: [], origins: [] } });
    expect((await anon.get("/api/horizon.csv")).status()).toBe(401);
    await anon.dispose();

    const count = await openHorizon(page);
    await expect(page.getByTestId("horizon-export")).toHaveAttribute("href", "/api/horizon.csv");
    const res = await page.request.get("/api/horizon.csv");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/csv");
    const lines = (await res.text()).trimEnd().split("\r\n");
    expect(lines[0]).toMatch(/^check_number,payee,property_type,amount_usd,/);
    expect(lines.length - 1).toBe(count);
  });

  test("the scrubber projects forward without touching the demo clock", async ({ page }) => {
    const before = await clockToday(page);
    await openHorizon(page);
    const firstDot = page.getByTestId("horizon-dot").first();
    const t0 = await firstDot.evaluate((e) => getComputedStyle(e).transform);

    const slider = page.getByRole("slider", { name: "Project forward" });
    await slider.focus();
    await page.keyboard.press("End");
    await expect(page.getByTestId("horizon-offset")).toHaveText("+365 days");
    await expect(page.getByTestId("horizon-at")).toContainText("At +365 days");
    const t1 = await firstDot.evaluate((e) => getComputedStyle(e).transform);
    expect(t1).not.toBe(t0);

    await page.getByRole("button", { name: "+90d" }).click();
    await expect(page.getByTestId("horizon-offset")).toHaveText("+90 days");
    await page.getByRole("button", { name: "Today" }).click();
    await expect(page.getByTestId("horizon-offset")).toHaveText("+0 days");

    expect(await clockToday(page)).toBe(before);
    await page.reload();
    await expect(page.getByTestId("horizon")).toBeVisible({ timeout: 30_000 });
    expect(await clockToday(page)).toBe(before);
  });

  test("dots are keyboard reachable with a roving tabindex and fill the readout", async ({ page }) => {
    await openHorizon(page);
    const dots = page.getByTestId("horizon-dot");
    await expect(page.locator(".hr-dot[tabindex='0']")).toHaveCount(1);
    await dots.first().focus();
    const firstName = (await page.getByTestId("worklist-row").first().locator("th").first().locator("span").first().textContent())!;
    await expect(page.getByTestId("horizon-readout")).toContainText(firstName);
    await page.keyboard.press("ArrowRight");
    await expect(dots.nth(1)).toBeFocused();
    await expect(dots.nth(1)).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("horizon-readout")).toContainText("Presumed abandoned");
  });

  for (const width of WIDTHS) {
    test(`no horizontal overflow and axe serious/critical clean at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await openHorizon(page);
      await page.getByTestId("horizon-dot").first().focus();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
      const { violations } = await new AxeBuilder({ page }).setLegacyMode(true).withTags(WCAG_TAGS).analyze();
      const blocking = violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.help}`);
      expect(blocking, `horizon @ ${width}px: serious/critical axe violations`).toEqual([]);
      if (width !== 1024) await page.screenshot({ path: `${SHOTS}/horizon-static-${width}.png`, fullPage: true });
    });
  }
});

test.describe("pre-stale horizon (motion allowed: tilted radar)", () => {
  test.use({ reducedMotion: "no-preference" });

  for (const width of [375, 1440] as const) {
    test(`tilts in 3D with no overflow at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await openHorizon(page);
      const radar = page.getByTestId("horizon-radar");
      await expect(radar).not.toHaveAttribute("data-tier", "static");
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
      await page.getByTestId("horizon-dot").first().hover();
      await expect(page.getByTestId("horizon-readout")).toContainText("Stale in");
      await radar.screenshot({ path: `${SHOTS}/horizon-radar-${width}.png`, animations: "disabled" });
      await page.screenshot({ path: `${SHOTS}/horizon-3d-${width}.png`, fullPage: true, animations: "disabled" });
    });
  }
});
