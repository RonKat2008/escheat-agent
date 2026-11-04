/**
 * Round 8, clock slice (R8-01, R8-09).
 *  - R8-01: moving the demo clock +90 days runs stale detection as part of the move, so Dashboard, Ledger closing,
 *    Horizon and chat agree: nothing waits "for the next detection run", and the liability grows by exactly what the
 *    clock response says it detected. Reset brings the day-0 numbers back.
 *  - R8-09: Activity logs the jump (and the detection) under the new demo day; the seed's rows stay on the anchor day.
 *  - axe (legacy mode) clean and no horizontal overflow at 375/1024/1440. Screenshots in .data/shots/r8-clock/.
 * Mutates the clock and restores it in `finally`:
 *   E2E_PORT=3931 E2E_DIR_SUFFIX=r8clock CI=1 pnpm exec playwright test tests/e2e/ui-r8-clock.spec.ts --project ui
 * Chat is checked only when the server runs with ESCHEAT_OFFLINE=1 (answers from data, no model).
 */
import { mkdirSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "playwright/test";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const DISCLAIMER = "Prototype. Not legal advice. Confirm filings with a qualified professional.";
const SHOTS = ".data/shots/r8-clock";
const WIDTHS = [375, 1024, 1440] as const;

test.use({ reducedMotion: "reduce" });
test.beforeAll(() => mkdirSync(SHOTS, { recursive: true }));
test.beforeEach(({}, info) => test.skip(info.project.name !== "ui", "runs in the ui project only"));
test.describe.configure({ timeout: 360_000 });

const cents = (s: string | null | undefined) => Math.round(Number((s ?? "").replace(/[^\d.]/g, "")) * 100);

async function axeBlocking(page: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page }).setLegacyMode(true).withTags(WCAG_TAGS).analyze();
  return violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
}
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

async function open(page: Page, path: string, ready: string) {
  await page.goto(path, { timeout: 90_000 });
  await expect(page.getByTestId(ready).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(DISCLAIMER).first()).toBeVisible();
}

/** The dashboard's whole open liability: the headline (not yet reported) plus the "+ N reported, $X to remit" line. */
async function dashboardCents(page: Page): Promise<number> {
  await open(page, "/dashboard", "exposure-meta");
  const unreported = cents(await page.getByTestId("money-flow").getByTestId("flow-exposure").innerText());
  const note = page.getByTestId("exposure-reported-note");
  const reported = (await note.count()) > 0 ? cents(await note.getByRole("link").innerText()) : 0;
  return unreported + reported;
}

async function ledgerClosing(page: Page): Promise<number> {
  await open(page, "/ledger", "ledger-closing");
  await expect(page.getByTestId("ledger-closing")).toHaveAttribute("data-reconciles", "true");
  return cents(await page.getByTestId("ledger-closing").innerText());
}

interface ClockResponse {
  today: string;
  detected: { count: number; cents: number };
}

test("R8-01/R8-09: a +90 day jump detects newly stale items; every surface agrees; Activity logs the jump on its demo day", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const day0 = await dashboardCents(page);
  expect(day0).toBeGreaterThan(0);
  expect(await ledgerClosing(page)).toBe(day0);
  // On a fresh seed Horizon may already show crossed items only if detection lags; it must not.
  await open(page, "/horizon", "horizon-basis");
  await expect(page.getByTestId("horizon-basis")).not.toContainText("wait for the next detection run");

  const res = await page.request.post("/api/clock", { data: { action: "advance", days: 90 } });
  expect(res.status(), await res.text()).toBeLessThan(300);
  const moved = (await res.json()) as ClockResponse;
  try {
    expect(moved.today).toBe("2027-01-30");
    // The seed's synthetic ledger has payments that cross the 180-day line in these 90 days (the dogfood saw 8).
    expect(moved.detected.count).toBeGreaterThan(0);

    // Dashboard total == day-0 total + exactly what the clock move detected == Ledger closing.
    const dash = await dashboardCents(page);
    expect(dash).toBe(day0 + moved.detected.cents);
    await page.screenshot({ path: `${SHOTS}/dashboard-plus90-1440.png`, fullPage: true });
    expect(await ledgerClosing(page)).toBe(dash);
    await page.screenshot({ path: `${SHOTS}/ledger-plus90-1440.png`, fullPage: true });

    // Horizon: nothing past the stale line is left outside the liability.
    await open(page, "/horizon", "horizon-basis");
    await expect(page.getByTestId("horizon-basis")).toContainText("Jan 30, 2027");
    await expect(page.getByTestId("horizon-basis")).not.toContainText("already crossed the stale line");
    await page.screenshot({ path: `${SHOTS}/horizon-plus90-1440.png`, fullPage: true });

    // Activity: the jump and the detection are entries under Jan 30, 2027; the seed's ingestion stays on Nov 1, 2026.
    await open(page, "/activity", "activity-log");
    const jumpDay = page.locator('[data-testid="activity-day"][data-day="2027-01-30"]');
    await expect(jumpDay.locator('[data-testid="activity-entry"][data-kind="clock"]').filter({ hasText: "Demo clock moved forward to Jan 30, 2027" })).toHaveCount(1);
    await expect(jumpDay.locator('[data-testid="activity-entry"][data-kind="clock"]').filter({ hasText: `Detected ${moved.detected.count} newly stale item` })).toHaveCount(1);
    const days = await page.getByTestId("activity-day").evaluateAll((els) => els.map((e) => e.getAttribute("data-day") ?? ""));
    // Other specs in the shared ui DB may have visited other demo days; what must never show is the real calendar date
    // (the R8-09 bug grouped the seed under "today" on the wall clock), unless the demo clock really showed that day.
    const realDay = new Date().toISOString().slice(0, 10);
    expect(days).toContain("2027-01-30");
    if (realDay !== "2027-01-30" && realDay !== "2026-11-01") expect(days, `demo days shown: ${days.join(", ")}`).not.toContain(realDay);
    // The seed's ingestion rows are the oldest entries (maybe past the first page): filter to them.
    await open(page, "/activity?kind=ingestion", "activity-log");
    await expect(page.locator('[data-testid="activity-entry"][data-kind="ingestion"]').first()).toBeVisible();
    const ingestDays = await page.getByTestId("activity-day").evaluateAll((els) => els.map((e) => e.getAttribute("data-day") ?? ""));
    expect(ingestDays).toEqual(["2026-11-01"]);

    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
      for (const [path, ready, name] of [
        ["/activity", "activity-log", "activity"],
        ["/dashboard", "exposure-meta", "dashboard"],
      ] as const) {
        await open(page, path, ready);
        await page.waitForTimeout(400);
        expect(await overflow(page), `${path} overflow at ${width}`).toBeLessThanOrEqual(0);
        expect(await axeBlocking(page), `${path} axe at ${width}`).toEqual([]);
        await page.screenshot({ path: `${SHOTS}/${name}-plus90-${width}.png`, fullPage: width !== 375 });
      }
    }

    // Chat (offline only: answered directly from the data, no model): the same liability.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/chat", { timeout: 90_000 });
    await expect(page.getByTestId("chat-input")).toBeVisible({ timeout: 30_000 });
    const offline = ((await page.getByTestId("chat-model").textContent()) ?? "").includes("offline");
    if (offline) {
      await page.getByTestId("chat-example").filter({ hasText: "What do we owe and where?" }).click();
      const last = page.getByTestId("chat-assistant-message").last();
      await expect(last).toHaveAttribute("data-status", "done", { timeout: 60_000 });
      const m = /You have (\$[\d,]+\.\d{2}) across \d+ open stale items/.exec(await last.innerText());
      expect(m, "chat states the liability").not.toBeNull();
      expect(cents(m![1])).toBe(dash);
      await page.screenshot({ path: `${SHOTS}/chat-plus90-1440.png` });
    }
  } finally {
    const reset = await page.request.post("/api/clock", { data: { action: "reset" } });
    expect(reset.status()).toBeLessThan(300);
  }

  // Reset removes the untouched clock detections: day-0 numbers come back exactly.
  await page.setViewportSize({ width: 1440, height: 900 });
  expect(await dashboardCents(page)).toBe(day0);
});

test("R8-01: a +365 day jump also leaves nothing awaiting detection, and Reset restores day 0", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const day0 = await dashboardCents(page);
  const res = await page.request.post("/api/clock", { data: { action: "advance", days: 365 } });
  expect(res.status(), await res.text()).toBeLessThan(300);
  const moved = (await res.json()) as ClockResponse;
  try {
    const dash = await dashboardCents(page);
    expect(dash).toBe(day0 + moved.detected.cents);
    expect(await ledgerClosing(page)).toBe(dash);
    await page.goto("/horizon", { timeout: 90_000 });
    const root = page.locator('[data-testid="horizon-basis"], [data-testid="horizon-empty"]').first();
    await expect(root).toBeVisible({ timeout: 60_000 });
    await expect(root).not.toContainText("wait for the next detection run");
    await page.screenshot({ path: `${SHOTS}/horizon-plus365-1440.png`, fullPage: true });
  } finally {
    await page.request.post("/api/clock", { data: { action: "reset" } });
  }
  expect(await dashboardCents(page)).toBe(day0);
});
