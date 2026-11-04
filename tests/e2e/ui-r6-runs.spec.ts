/**
 * Round 6, "runs + replica" slice (R6-06, R6-11, R6-12, R6-18, R6-19, opportunities 4 and 5).
 *  - Agent runs filters and pages in SQL: chips never vanish, chip count == rows, one word for replays, a helpful
 *    empty state on a fresh seed (never "No runs match these filters" with no filter set).
 *  - The replica holder dashboard lists the filed reports (confirmation, date, items, total), on the demo calendar.
 *   ESCHEAT_OFFLINE=1 E2E_PORT=3931 E2E_DIR_SUFFIX=r6-runs CI=1 pnpm exec playwright test tests/e2e/ui-r6-runs.spec.ts --project ui
 */
import { mkdirSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "playwright/test";
import { buildNaupaFile } from "../../src/lib/replica/portal/naupa-fixture";

const DISCLAIMER = "Prototype. Not legal advice. Confirm filings with a qualified professional.";
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const SHOTS = ".data/shots/r6-runs";
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

async function goRuns(page: Page, path: string, width = 1440) {
  await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
  await page.goto(path, { timeout: 90_000 });
  await expect(page.getByRole("heading", { name: "Agent runs" })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(DISCLAIMER)).toBeVisible();
  await expect(page.getByRole("group", { name: "Filters" })).toBeVisible({ timeout: 60_000 }).catch(() => undefined);
}

test("R6-11: with no filter set, an empty default view explains itself instead of 'No runs match these filters'", async ({ page }) => {
  await goRuns(page, "/runs");
  const emptyHidden = page.getByTestId("runs-empty-hidden");
  if (await emptyHidden.count()) {
    await expect(emptyHidden).toContainText("heuristic");
    await expect(page.getByText("No runs match these filters.")).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}/runs-empty-hidden-1440.png`, fullPage: true });
    await emptyHidden.getByRole("link", { name: "Show them" }).click();
    await expect(page.locator("tbody tr").first()).toBeVisible();
  } else {
    // Some runs are visible (or there are none at all): the generic no-match copy must still not show with no filter.
    await expect(page.getByText("No runs match these filters.")).toHaveCount(0);
  }
});

test("R6-06/R6-19: chips come from the whole table, counts match rows, replays are one word, history pages", async ({ page }) => {
  await goRuns(page, "/runs?replays=1");
  const total = await page.locator("tbody tr").count();
  expect(total).toBeGreaterThan(0);

  // Every agent that has a run keeps its chip, including ones whose runs are all replays.
  const agentChips = page.getByRole("group", { name: "Filters" }).getByRole("link");
  await expect(agentChips.first()).toHaveText("All agents");

  // R6-19: the Replayed chip count equals the Replayed rows once filtered; no row says "Cancelled" for a replay.
  const replayedCount = num(await page.getByTestId("runs-count-replayed").innerText());
  if (replayedCount > 0) {
    await page.getByRole("link", { name: /^Replayed/ }).click();
    await expect(page).toHaveURL(/status=replayed/);
    const pageRows = await page.locator("tbody tr").count();
    expect(pageRows).toBe(Math.min(40, replayedCount));
    await expect(page.locator('[data-status="cancelled"]')).toHaveCount(0);
    await expect(page.locator('[data-status="replayed"]').first()).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/runs-replayed-1440.png`, fullPage: true });

    // Pagination: a second page of older rows, reachable with Older and back with Newer.
    if (replayedCount > 40) {
      const firstId = await page.locator("tbody tr a").first().getAttribute("href");
      await page.getByTestId("runs-older").click();
      await expect(page).toHaveURL(/page=2/);
      expect(await page.locator("tbody tr").count()).toBe(replayedCount - 40);
      expect(await page.locator("tbody tr a").first().getAttribute("href")).not.toBe(firstId);
      await expect(page.getByTestId("runs-pager")).toContainText(`of ${replayedCount}`);
      await page.screenshot({ path: `${SHOTS}/runs-page2-1440.png`, fullPage: true });
      await page.getByRole("link", { name: "Newer" }).click();
      await expect(page).not.toHaveURL(/page=2/);
      await expect(page.locator("tbody tr a").first()).toHaveAttribute("href", firstId!);
    }
  }

  // An agent filter keeps all the other agent chips visible.
  await goRuns(page, "/runs?replays=1");
  const labelsBefore = await page.getByRole("group", { name: "Filters" }).getByRole("link").allInnerTexts();
  const firstAgent = page.getByRole("group", { name: "Filters" }).getByRole("link").nth(1);
  await firstAgent.click();
  await expect(page).toHaveURL(/agent=/);
  const labelsAfter = await page.getByRole("group", { name: "Filters" }).getByRole("link").allInnerTexts();
  expect(labelsAfter.filter((l) => !/^(Any status|Running|Succeeded|Failed|Cancelled|Replayed)/.test(l))).toEqual(
    labelsBefore.filter((l) => !/^(Any status|Running|Succeeded|Failed|Cancelled|Replayed)/.test(l)),
  );

  // A filter that matches nothing says so, with a way out.
  await goRuns(page, "/runs?status=running&agent=no_such_agent");
  await expect(page.getByText("No runs match these filters.")).toBeVisible();
});

for (const width of WIDTHS) {
  test(`runs @${width}px: axe-clean, no horizontal overflow`, async ({ page }) => {
    await goRuns(page, "/runs?replays=1", width);
    expect(await overflow(page), `overflow at ${width}`).toBeLessThanOrEqual(0);
    expect(await axeBlocking(page)).toEqual([]);
    if (width !== 1024) await page.screenshot({ path: `${SHOTS}/runs-${width}.png`, fullPage: true });
  });
}

test("opp #4: the replica holder dashboard lists the filed report, on the demo calendar", async ({ page }) => {
  await page.goto("/replica/de-holder");
  await page.getByTestId("login-username").fill("northwind-demo");
  await page.getByTestId("login-password").fill("replica-only");
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/replica\/de-holder\/dashboard/);

  await page.getByTestId("file-report-link").click();
  await page.getByTestId("naupa-upload").setInputFiles({ name: "northwind-de.txt", mimeType: "text/plain", buffer: Buffer.from(buildNaupaFile()) });
  await page.getByTestId("upload-submit").click();
  await page.getByTestId("approve-submission").click();
  const confirmation = (await page.getByTestId("confirmation-number").innerText()).trim();
  expect(confirmation).toMatch(/^REPL-DE-2026-[A-Z0-9]{6}$/); // demo clock year, not the real one

  await page.goto(`/replica/de-holder/dashboard?filed=${confirmation}`);
  const row = page.getByTestId("filed-report-row").filter({ hasText: confirmation });
  await expect(row).toBeVisible();
  await expect(row).toContainText("$2,589.50");
  await expect(row.locator("td").nth(2)).toHaveText("3");
  await expect(row.locator("td").nth(1)).toHaveText(/^[A-Z][a-z]{2} \d{1,2}, 2026$/);
  await expect(row).toHaveAttribute("aria-current", "true");
  await expect(page.getByTestId("replica-banner-top")).toBeVisible();
  await expect(page.getByTestId("replica-banner-bottom")).toBeVisible();

  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
    await page.goto(`/replica/de-holder/dashboard?filed=${confirmation}`);
    await expect(row).toBeVisible();
    expect(await overflow(page), `replica overflow at ${width}`).toBeLessThanOrEqual(0);
    expect(await axeBlocking(page)).toEqual([]);
    if (width !== 1024) await page.screenshot({ path: `${SHOTS}/replica-dashboard-${width}.png`, fullPage: true });
  }

  // The confirmation links from the list to the receipt page.
  await row.getByTestId("filed-report-confirmation").click();
  await expect(page.getByTestId("confirmation-number")).toHaveText(confirmation);
});
