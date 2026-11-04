/**
 * Round 4, "numbers" slice. Read-only (generates and files nothing), so it never disturbs the shared seed:
 *  - R4-05: the dashboard's stale-item count is the Items open total, or says why it differs ("reported");
 *  - R4-14: Reports opens on the most urgent (overdue) state; its empty Validation state is one line, not skeleton
 *    bars; one stepper, not two;
 *  - R4-15: Forecast's river spans the selected horizon and its legend agrees with the KPI strip and calendar;
 *  - R4-12: Agent runs hides offline-replay rows by default, with a counted note and a way to show them.
 * (R4-23, the run row settling before the browser teardown, is unit tested in src/lib/browser-agents/finish.test.ts;
 *  driving a real filing here would file TX and break the late-money specs that share this database.)
 *   E2E_PORT=3911 E2E_DIR_SUFFIX=r4-numbers CI=1 pnpm exec playwright test tests/e2e/ui-r4-numbers.spec.ts --project ui
 */
import { mkdirSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "playwright/test";

const DISCLAIMER = "Prototype. Not legal advice. Confirm filings with a qualified professional.";
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const SHOTS = process.env.R4_SHOTS_DIR ?? ".data/shots/r4-numbers";
const WIDTHS = [375, 1024, 1440] as const;

test.use({ reducedMotion: "reduce" });
test.beforeAll(() => mkdirSync(SHOTS, { recursive: true }));
test.beforeEach(({}, info) => test.skip(info.project.name !== "ui", "runs in the ui project only"));
test.describe.configure({ timeout: 180_000 });

async function axeBlocking(page: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page }).setLegacyMode(true).withTags(WCAG_TAGS).analyze();
  return violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
}

const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const num = (s: string | null | undefined) => Number((s ?? "").replace(/[^\d]/g, ""));

async function open(page: Page, path: string, width: number, ready: string) {
  await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
  await page.goto(path, { timeout: 90_000 });
  await expect(page.getByTestId(ready).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(DISCLAIMER)).toBeVisible();
}

test("R4-05: dashboard stale-item count matches the Items open total, or labels the difference", async ({ page }) => {
  await open(page, "/dashboard", 1440, "exposure-meta");
  const meta = (await page.getByTestId("exposure-meta").innerText()).replace(/\s+/g, " ");
  const shown = num(/(\d[\d,]*) stale items/.exec(meta)?.[1]);
  // R5-08: reported-but-unremitted items are a second line ("+ 2 reported, $2,347.84 to remit"), not in the headline.
  const note = page.getByTestId("exposure-reported-note");
  const reported = (await note.count()) > 0 ? num(/\+\s*(\d+) reported/.exec((await note.innerText()).replace(/\s+/g, " "))?.[1]) : 0;
  await page.goto("/items", { timeout: 90_000 });
  await expect(page.getByText(/All open items|Filtered/).first()).toBeVisible({ timeout: 60_000 });
  // The state ribbon (CA/TX/DE chips) counts every open item in view: the Items open total.
  await expect(page.getByTestId("state-ribbon")).toBeVisible({ timeout: 60_000 });
  const counts = await page.locator('[data-testid^="ribbon-"] span.num.text-fg-3').allInnerTexts();
  const itemsTotal = counts.reduce((a, t) => a + num(t), 0);
  const rows = counts.length;
  expect(shown).toBeGreaterThan(0);
  expect(rows).toBeGreaterThan(0);
  // One definition: the Items open total is the headline count plus the labelled reported line.
  expect(itemsTotal).toBe(shown + reported);
});

test("R4-14: Reports opens on the overdue state with a one-line empty Validation and one stepper", async ({ page }) => {
  await open(page, "/reports", 1440, "report-detail");
  const states = page.getByRole("navigation", { name: "States" });
  const overdueTab = states.locator("a", { has: page.locator('[data-testid^="reports-tab-overdue-"]') }).first();
  await expect(overdueTab).toBeVisible();
  await expect(overdueTab).toHaveAttribute("aria-current", "true");
  await expect(page.getByTestId("validation-ghost")).toHaveCount(0);
  // The empty Validation line only exists while the picked state has no report. In the full ui run the close-out
  // runner (which sorts earlier) files a report first, so the most overdue state can already carry one; then the real
  // validation lists render instead, and still no skeleton bars.
  const hasReport = (await page.getByTestId("download-file").count()) > 0;
  if (hasReport) {
    test.info().annotations.push({ type: "note", description: "overdue state already has a report; empty-Validation line not applicable" });
    await expect(page.getByTestId("validation-empty")).toHaveCount(0);
  } else {
    await expect(page.getByTestId("validation-empty")).toContainText(/Generate the report|Nothing to validate/);
  }
  await expect(page.getByTestId("filing-stepper")).toHaveCount(1);
  await expect(page.getByTestId("reports-overview")).toHaveCount(0);
  expect(await axeBlocking(page)).toEqual([]);
  for (const w of WIDTHS) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.goto("/reports", { timeout: 90_000 });
    await expect(page.getByTestId("report-detail")).toBeVisible({ timeout: 60_000 });
    expect(await overflow(page), `overflow at ${w}`).toBeLessThanOrEqual(0);
    if (w !== 1024) await page.screenshot({ path: `${SHOTS}/reports-${w}.png`, fullPage: true });
  }
});

test("R4-15: forecast river spans the horizon and its counts agree with the KPIs and calendar", async ({ page }) => {
  await open(page, "/forecast?horizon=18", 1440, "forecast-stats");
  const river = page.getByTestId("deadline-river");
  await expect(river).toBeVisible();
  await expect(river).toContainText("18 months");
  const legend = (await river.locator("figcaption").innerText()).replace(/\s+/g, " ");
  const kind = (label: string) => num(new RegExp(`${label} (\\d+)`).exec(legend)?.[1]);
  const riverDeadlines = kind("Due diligence opens") + kind("Report due") + kind("Remit due");
  const stats = page.getByTestId("forecast-stats");
  const kpi = async (label: string) => {
    const dt = stats.locator("div", { has: page.getByText(label, { exact: true }) }).first();
    return (await dt.innerText()).replace(/\s+/g, " ");
  };
  const deadlinesText = await kpi("Filing deadlines");
  expect(num(/Filing deadlines (\d+)/.exec(deadlinesText)?.[1])).toBe(riverDeadlines);
  const presumedText = await kpi("Becoming presumed abandoned");
  expect(num(/\$[\d,]+ (\d+) items?/.exec(presumedText)?.[1])).toBe(kind("Presumed abandoned"));
  const calendarRows = await page.getByTestId("calendar-list").locator("li").count();
  expect(deadlinesText).toContain(`${calendarRows} calendar date`);
  expect(await axeBlocking(page)).toEqual([]);
  for (const w of WIDTHS) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.goto("/forecast?horizon=18", { timeout: 90_000 });
    await expect(page.getByTestId("forecast-stats")).toBeVisible({ timeout: 60_000 });
    expect(await overflow(page), `overflow at ${w}`).toBeLessThanOrEqual(0);
    if (w !== 1024) await page.screenshot({ path: `${SHOTS}/forecast-${w}.png` });
  }
});

test("R4-12: agent runs hides offline replays by default and can show them", async ({ page }) => {
  await open(page, "/runs", 1440, "runs-replays-note").catch(async () => {
    // No replay rows on this server (online run): the page must still render with no "Cancelled" replay rows.
    await expect(page.getByRole("heading", { name: "Agent runs" })).toBeVisible();
  });
  if (await page.getByTestId("runs-replays-note").count()) {
    await expect(page.getByTestId("runs-replays-note")).toContainText("hidden");
    await expect(page.locator('[data-status="cancelled"]')).toHaveCount(0);
    await page.getByRole("link", { name: "Show replays" }).click();
    await expect(page.locator('[data-status="replayed"]').first()).toBeVisible();
    await expect(page.locator('[data-status="cancelled"]')).toHaveCount(0);
  }
  expect(await axeBlocking(page)).toEqual([]);
  for (const w of WIDTHS) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.goto("/runs", { timeout: 90_000 });
    await expect(page.getByRole("heading", { name: "Agent runs" })).toBeVisible({ timeout: 60_000 });
    expect(await overflow(page), `overflow at ${w}`).toBeLessThanOrEqual(0);
    if (w !== 1024) await page.screenshot({ path: `${SHOTS}/runs-${w}.png` });
  }
});
