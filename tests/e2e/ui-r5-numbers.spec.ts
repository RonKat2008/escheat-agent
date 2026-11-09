/**
 * Dogfood round 5, "one set of numbers" slice (R5-07, R5-08, R5-14, R5-19, R5-21). Read-only: generates, sends and
 * files nothing, so it never disturbs the shared ui seed. (R5-09, status moving on send/reply, and the +1y Late band
 * are unit tested in src/lib/pipeline/status-events.test.ts and src/lib/queries/reconcile.test.ts, where the clock can
 * move without racing the other ui specs.)
 *   E2E_PORT=3931 E2E_DIR_SUFFIX=r5-numbers CI=1 pnpm exec playwright test tests/e2e/ui-r5-numbers.spec.ts --project ui
 */
import { mkdirSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "playwright/test";
import { openDashboardDetail } from "./dashboard-detail";

const DISCLAIMER = "Prototype. Not legal advice. Confirm filings with a qualified professional.";
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const SHOTS = ".data/shots/r5-numbers";
const WIDTHS = [375, 1024, 1440] as const;

test.use({ reducedMotion: "reduce" });
test.beforeAll(() => mkdirSync(SHOTS, { recursive: true }));
test.beforeEach(({}, info) => test.skip(info.project.name !== "ui", "runs in the ui project only"));
test.describe.configure({ timeout: 180_000 });

const cents = (s: string | null | undefined) => Math.round(Number((s ?? "").replace(/[^\d.]/g, "")) * 100);
const int = (s: string | null | undefined) => Number((s ?? "").replace(/[^\d]/g, ""));

async function open(page: Page, path: string, width: number, ready: string) {
  await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
  await page.goto(path, { timeout: 90_000 });
  await expect(page.getByTestId(ready).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(DISCLAIMER)).toBeVisible();
}

async function axeBlocking(page: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page }).setLegacyMode(true).withTags(WCAG_TAGS).analyze();
  return violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
}

const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test("R5-08: the headline count, its dollars, the Money Flow and Items measure one set", async ({ page }) => {
  await open(page, "/dashboard", 1440, "exposure-meta");
  await openDashboardDetail(page);
  const count = int(await page.getByTestId("exposure-count").innerText());
  const flow = page.getByTestId("money-flow");
  const flowCents = cents(await flow.getByTestId("flow-exposure").innerText());
  const note = page.getByTestId("exposure-reported-note");
  const reported = (await note.count()) > 0 ? int(/\+\s*(\d+) reported/.exec((await note.innerText()).replace(/\s+/g, " "))?.[1]) : 0;
  expect(count).toBeGreaterThan(0);

  await page.goto("/items", { timeout: 90_000 });
  await expect(page.getByTestId("items-total-row")).toBeVisible({ timeout: 60_000 });
  const rows = await page.locator("tbody tr[data-row-id]").count();
  expect(rows).toBe(count + reported);
  if (reported > 0) {
    const split = (await page.getByTestId("items-total-split").innerText()).replace(/\s+/g, " ");
    expect(int(/(\d+) not yet reported/.exec(split)?.[1])).toBe(count);
    expect(cents(/not yet reported, (\$[\d,]+\.\d{2})/.exec(split)?.[1])).toBe(flowCents);
  } else {
    await expect(page.getByTestId("items-total-split")).toHaveCount(0);
    expect(cents((await page.getByTestId("items-total-row").locator("td.text-right").first().innerText()).trim())).toBe(flowCents);
  }
});

test("R5-07 / R5-19: the pink caption names only drawn bands, and card amounts round instead of truncating", async ({ page }) => {
  await open(page, "/dashboard", 1440, "exposure-meta");
  await openDashboardDetail(page);
  const flow = page.getByTestId("money-flow");
  await flow.scrollIntoViewIfNeeded();
  // Bands and cards are laid out client side once the diagram measures its width.
  await expect(flow.locator("[data-flow-root] [data-flow-node]").first()).toBeVisible({ timeout: 30_000 });
  await expect(flow.locator("[data-flow-root] [data-flow-band]").first()).toBeAttached({ timeout: 30_000 });
  const caption = await flow.getByTestId("flow-pink-caption").innerText();
  const late = await flow.locator("[data-flow-root] [data-flow-band][data-tone=late]").count();
  const human = await flow.locator("[data-flow-root] [data-flow-band][data-tone=human]").count();
  if (late === 0) expect(caption).not.toMatch(/Late is past|other pink/);
  if (human === 0) expect(caption).not.toContain("letter awaiting approval");
  if (late > 0 && human > 0) expect(caption).toContain("the other pink bands");
  if (late > 0 && human === 0) expect(caption).not.toContain("other");

  // Each card shows a rounded label; its accessible name carries the exact cents. "$773.74" must read "$774", not "$773".
  const cards = await flow.locator("[data-flow-root] [data-flow-node]").evaluateAll((els) =>
    els.map((e) => ({ id: e.getAttribute("data-flow-node"), shown: e.querySelector(".num")?.textContent ?? "", exact: e.querySelector(".sr-only")?.textContent ?? "" })),
  );
  expect(cards.length).toBeGreaterThan(2);
  for (const c of cards) {
    const exact = Number(/\$([\d,]+\.\d{2})/.exec(c.exact)?.[1]?.replace(/,/g, "")) * 100;
    const m = /\$([\d,.]+)(k|M)?/.exec(c.shown);
    expect(m, `${c.id} shows an amount`).not.toBeNull();
    const unit = m![2] === "k" ? 100_000 : m![2] === "M" ? 100_000_000 : 100;
    const step = m![2] === "k" ? 10_000 : m![2] === "M" ? 1_000_000 : 100;
    const shown = Number(m![1]!.replace(/,/g, "")) * unit;
    expect(Math.abs(shown - exact), `${c.id}: ${c.shown} for ${c.exact}`).toBeLessThanOrEqual(step / 2 + 1);
  }
  await flow.screenshot({ path: `${SHOTS}/flow-1440.png` });
});

test("R5-14: every overdue item is in Needs action", async ({ page }) => {
  await open(page, "/items?overdue=1", 1440, "view-needs-action");
  const all = int(await page.getByTestId("view-count-all").innerText());
  const needs = int(await page.getByTestId("view-count-needs-action").innerText());
  expect(needs).toBe(all);
  await page.screenshot({ path: `${SHOTS}/items-overdue-1440.png` });
});

test("R5-21: the Activity header count matches its day groups", async ({ page }) => {
  // Pinned to the demo day (R8-09): clock jumps by other specs in the shared DB are logged on later demo days, which
  // moves the strip's window past today; with `to` both the strip and the feed end on the same demo day.
  await open(page, "/activity?to=2026-11-01", 1440, "activity-day");
  const header = int(await page.locator("#activity-strip-h .num").first().innerText());
  const days = await page.getByTestId("activity-day-count").allInnerTexts();
  const dayTotals = days.map((t) => int(/of (\d+)/.exec(t)?.[1] ?? /(\d+)/.exec(t)?.[1]));
  const shownTotals = days.map((t) => int(/(\d+)/.exec(t)?.[1]));
  for (let i = 0; i < days.length; i++) expect(shownTotals[i]).toBeLessThanOrEqual(dayTotals[i]!);
  if (days.length === 1) expect(dayTotals[0]).toBe(header);
  else expect(dayTotals.reduce((a, n) => a + n, 0)).toBeLessThanOrEqual(header);
});

for (const [name, path, ready] of [
  ["dashboard", "/dashboard", "exposure-meta"],
  ["items", "/items", "items-total-row"],
  ["activity", "/activity", "activity-day"],
] as const) {
  test(`${name}: axe clean and no horizontal overflow at 375/1024/1440`, async ({ page }) => {
    for (const w of WIDTHS) {
      await open(page, path, w, ready);
      expect(await overflow(page), `${name} overflow at ${w}`).toBeLessThanOrEqual(0);
      if (w !== 1024) await page.screenshot({ path: `${SHOTS}/${name}-${w}.png`, fullPage: true });
    }
    expect(await axeBlocking(page)).toEqual([]);
  });
}
