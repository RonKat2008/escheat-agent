/**
 * DESIGN-V3 slice 2 (dashboard): the Money Map and the money-flow Sankey render with real totals (the map columns and
 * the Sankey "At risk" nodes reconcile to the hero total); the overdue panel leads after the demo clock is advanced
 * (reset afterwards); reduced motion renders final, flat, static states; axe clean; no horizontal overflow at
 * 375/1024/1440; CLS under 0.1. Writes .data/shots/v3-dashboard-{1440,1024,375,reduced-1440}.png. Read-only apart from
 * the demo clock, which it resets.
 */
import { mkdirSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext, type Page } from "playwright/test";

const DISCLAIMER = "Prototype. Not legal advice. Confirm filings with a qualified professional.";
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const SHOTS = ".data/shots";
const WIDTHS = [375, 1024, 1440] as const;

const dollars = (s: string): number => Number(s.replace(/[^0-9.]/g, ""));

async function open(page: Page, width = 1440) {
  await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
  await page.goto("/dashboard", { timeout: 90_000 });
  await expect(page.getByRole("region", { name: "Total exposure" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(DISCLAIMER)).toBeVisible();
}

/** Let finite animations finish; the infinite particle loops never do, so they are skipped. */
async function settle(page: Page) {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
}

async function heroTotal(page: Page): Promise<number> {
  const text = (await page.getByRole("region", { name: "Total exposure" }).innerText()).match(/\$[\d,]+\.\d{2}/)?.[0];
  expect(text, "hero total").toBeTruthy();
  return dollars(text!);
}

async function clock(request: APIRequestContext, body: object) {
  const r = await request.post("/api/clock", { data: body });
  expect(r.status(), await r.text()).toBeLessThan(300);
}

async function axeBlocking(page: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page }).setLegacyMode(true).withTags(WCAG_TAGS).analyze();
  return violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
}

// Dev-server compiles under load can take well over 30s on first hit.
test.describe.configure({ mode: "serial", timeout: 150_000 });
test.beforeAll(() => mkdirSync(SHOTS, { recursive: true }));

test("the Money Map and the Sankey render with real totals that reconcile to the hero", async ({ page }) => {
  await open(page);
  await settle(page);
  const total = await heroTotal(page);
  expect(total).toBeGreaterThan(0);

  // Money Map: a column (a link with a full accessible name) per owner state.
  const columns = page.locator("[data-map-col]");
  await expect(columns.first()).toBeVisible();
  const names = await columns.evaluateAll((els) => els.map((e) => e.querySelector("[data-col-name]")?.textContent ?? ""));
  expect(names.length).toBeGreaterThan(0);
  for (const n of names) expect(n).toMatch(/^, [A-Z][a-z]+( [A-Z][a-z]+)*: \$[\d,]+\.\d{2} across \d+ items?/);
  const mapSum = names.reduce((a, n) => a + dollars(n.match(/\$[\d,]+\.\d{2}/)![0]), 0);
  const unplaced = await page.getByText(/Owner state unknown:/).count();
  if (unplaced === 0) expect(mapSum).toBeCloseTo(total, 2);
  await expect(page.getByTestId("state-tile-CA")).toBeVisible();

  // Sankey: the At risk nodes add up to the hero total, and the caption quotes the same figure.
  const flow = page.getByTestId("money-flow");
  await expect(flow).toBeVisible();
  expect(dollars((await flow.getByTestId("flow-exposure").textContent()) ?? "")).toBeCloseTo(total, 2);
  const atRisk = flow.locator("[data-flow-node^='state:']:visible");
  await expect(atRisk.first()).toBeAttached();
  const risk = await atRisk.evaluateAll((els) => els.map((e) => e.textContent ?? ""));
  expect(risk.reduce((a, n) => a + dollars(n.match(/\$[\d,]+\.\d{2}/)![0]), 0)).toBeCloseTo(total, 2);

  // Hovering a column shows its largest items in the readout; arrow keys move between columns.
  await page.getByTestId("state-tile-CA").focus();
  await expect(page.getByRole("list", { name: /Largest items in California/ })).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("[data-map-col]:focus")).toHaveCount(1);
  await page.screenshot({ path: `${SHOTS}/v3-dashboard-1440.png`, fullPage: true });
});

test("Needs you leads with exactly one primary action, and dates are in the demo-clock frame", async ({ page }) => {
  await open(page);
  const needs = page.getByTestId("needs-you");
  await expect(needs.getByRole("heading", { name: "Needs you" })).toBeVisible();
  const primaries = await needs.locator("a").evaluateAll((as) => as.filter((a) => a.className.split(" ").includes("bg-pink-500")).length); // V4: the primary is the coral pill
  expect(primaries).toBe(1);
  // Visible text only: the core LifecycleRail's sr-only table still carries ISO dates (a core follow-up, not this slice).
  const main = await page.locator("main").evaluate((root) => {
    const out: string[] = [];
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) if (!n.parentElement?.closest(".sr-only")) out.push(n.textContent ?? "");
    return out.join(" ");
  });
  // R3-12: no raw ISO dates in the visible dashboard body, and the as-of date is the demo date.
  expect(main).not.toMatch(/\b20\d\d-\d\d-\d\d\b/);
  const asOf = await page.getByTestId("exposure-meta").locator("time").getAttribute("datetime");
  await expect(page.getByTestId("demo-date")).toHaveAttribute("data-date", asOf!);
  await expect(page.getByTestId("deadline-strip")).toBeVisible();
});

test.describe("after advancing the demo clock one year", () => {
  test.beforeAll(async ({ request }) => {
    await clock(request, { action: "advance", days: 365 });
  });
  test.afterAll(async ({ request }) => {
    await clock(request, { action: "reset" });
  });

  test("the overdue panel follows the hero stage and leads Needs you", async ({ page }) => {
    await open(page);
    const panel = page.getByTestId("overdue-panel");
    await expect(panel).toBeVisible();
    const n = Number(await panel.getByTestId("overdue-count").textContent());
    expect(n).toBeGreaterThan(0);
    await expect(panel.getByTestId("overdue-amount")).toHaveText(/^\$[\d,]+\.\d{2}$/);
    await expect(panel).toContainText(/days? late/);
    const first = await page.evaluate(() => {
      // V4: the hero stage (headline + coral catch-up CTA) comes first; the full overdue band follows right under it.
      const a = document.querySelector("[data-testid=overdue-panel]");
      const b = document.querySelector("[data-testid=dash-stage]");
      return Boolean(a && b && b.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    expect(first).toBe(true);
    await expect(page.getByTestId("needs-you")).toContainText(n === 1 ? "item overdue" : "items overdue");
  });
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("renders final, flat and static: no tilt, no particles, no running animations", async ({ page }) => {
    await open(page);
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await expect(page.locator("[data-map-root]")).toHaveAttribute("data-tier", "static");
    await expect(page.locator("[data-map-root] circle")).toHaveCount(0);
    const running = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running" && Number(a.effect?.getTiming().duration) > 1).length);
    expect(running).toBe(0);
    // Columns render as bars with their labels; the Sankey is fully drawn.
    await expect(page.getByTestId("state-tile-CA")).toBeVisible();
    await expect(page.getByTestId("money-flow").locator("[data-flow-node]:visible").first()).toBeAttached();
    expect(await heroTotal(page)).toBeGreaterThan(0);
    expect(await page.getByTestId("state-bar").evaluate((el) => getComputedStyle(el).clipPath)).toBe("none");
    await page.screenshot({ path: `${SHOTS}/v3-dashboard-reduced-1440.png`, fullPage: true });
  });

  for (const width of [375, 1440] as const) {
    test(`axe serious/critical clean @${width}px`, async ({ page }) => {
      await open(page, width);
      expect(await axeBlocking(page)).toEqual([]);
    });
  }
});

test.describe("layout", () => {
  for (const width of WIDTHS) {
    test(`no horizontal overflow @${width}px (motion on)`, async ({ page }) => {
      await open(page, width);
      await settle(page);
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
      if (width !== 1440) await page.screenshot({ path: `${SHOTS}/v3-dashboard-${width}.png`, fullPage: true });
    });
  }

  for (const width of [375, 1440] as const) {
    test(`cumulative layout shift stays under 0.1 @${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
      await page.addInitScript(() => {
        const w = window as unknown as { __cls: number };
        w.__cls = 0;
        new PerformanceObserver((list) => {
          for (const e of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) if (!e.hadRecentInput) w.__cls += e.value;
        }).observe({ type: "layout-shift", buffered: true });
      });
      await open(page, width);
      await settle(page);
      expect(await page.evaluate(() => (window as unknown as { __cls: number }).__cls)).toBeLessThan(0.1);
    });
  }

  test("axe clean with the 3D map on (motion allowed) @1440px", async ({ page }) => {
    await open(page);
    await settle(page);
    expect(await axeBlocking(page)).toEqual([]);
  });
});
