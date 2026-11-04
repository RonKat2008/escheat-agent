/**
 * Motion, data-viz and confirmation polish on /forecast, /activity, /payees, /settings/integrations and /eval ("ui"
 * group). Covers: reduced motion renders everything final with no transforms; no overflow at 375/1024/1440; axe
 * serious/critical clean; CLS < 0.1 on /forecast and /activity with motion on; the chart/table cross-highlight; the
 * activity day strip; copy-to-clipboard feedback; the CSV import and payee merge confirmation moments.
 *
 * Runs after the other ui-* specs (file order), so the one write here (a no-money merge) cannot disturb them.
 * Deterministic waits only: elements, URLs, attributes, and Web Animations `finished` promises.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "playwright/test";
import { finishAnimations } from "./animations";

const PAGES = [
  // The chart frame, not a bar: with motion on, bars below the fold are legitimately scaleY(0) until scrolled into view.
  { name: "forecast", path: "/forecast", ready: (p: Page) => p.getByTestId("forecast-chart") },
  { name: "activity", path: "/activity", ready: (p: Page) => p.getByTestId("activity-entry").first() },
  { name: "payees", path: "/payees", ready: (p: Page) => p.getByTestId("payee-row").first() },
  { name: "integrations", path: "/settings/integrations", ready: (p: Page) => p.getByRole("button", { name: /Drop a CSV here/ }) },
  { name: "eval", path: "/eval", ready: (p: Page) => p.getByTestId("eval-overall") },
] as const;
const WIDTHS = [375, 1024, 1440] as const;
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const DISCLAIMER = "Prototype. Not legal advice. Confirm filings with a qualified professional.";
/** Elements that carry entrance motion; under reduced motion each must be final (no transform, full opacity). */
const MOTION_SELECTOR = ".es-iv-grow-x, .es-iv-grow-y, .es-iv-fade, .es-stagger, .es-pop-in, .es-rise, .es-grow-x, .es-grow-y";

async function open(page: Page, entry: (typeof PAGES)[number]) {
  await page.goto(entry.path);
  await expect(entry.ready(page)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(DISCLAIMER)).toBeVisible();
}

/** Scroll the whole page (so in-view reveals fire), back to top, then wait for every running animation to finish. */
async function settle(page: Page) {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.evaluate(async () => {
    for (let y = 0; y <= document.documentElement.scrollHeight; y += 300) {
      window.scrollTo(0, y);
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    }
    window.scrollTo(0, 0);
  });
  await finishAnimations(page);
}

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  for (const entry of PAGES) {
    test(`${entry.name}: everything renders final, with no transforms and no running animations`, async ({ page }) => {
      await open(page, entry);
      await page.waitForLoadState("networkidle").catch(() => undefined);
      const offenders = await page.evaluate((sel) => {
        const bad: string[] = [];
        for (const el of document.querySelectorAll<Element>(sel)) {
          const cs = getComputedStyle(el);
          if (cs.transform !== "none" || cs.opacity !== "1" || cs.animationName !== "none") {
            bad.push(`${el.tagName.toLowerCase()}.${String(el.getAttribute("class")).slice(0, 60)} transform=${cs.transform} opacity=${cs.opacity} anim=${cs.animationName}`);
          }
        }
        return bad;
      }, MOTION_SELECTOR);
      expect(offenders).toEqual([]);
      const running = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running" && Number.isFinite(Number(a.effect?.getTiming().duration)) && Number(a.effect?.getTiming().duration) > 1).length);
      expect(running).toBe(0);
    });
  }

  test("forecast bars and eval bars are fully drawn before any scrolling", async ({ page }) => {
    await open(page, PAGES[0]);
    const bar = page.getByTestId("forecast-chart").locator(".recharts-bar-rectangle path").first();
    await expect(bar).toBeVisible();
    const scale = await bar.evaluate((el) => getComputedStyle(el).transform);
    expect(scale).toBe("none");
    await open(page, PAGES[4]);
    const widths = await page.locator(".es-iv-grow-x").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width));
    expect(widths.length).toBeGreaterThan(0);
    expect(Math.min(...widths)).toBeGreaterThan(0);
  });
});

test.describe("layout and accessibility", () => {
  test.use({ reducedMotion: "reduce" });

  for (const entry of PAGES) {
    for (const width of WIDTHS) {
      test(`${entry.name} @${width}px: no horizontal overflow, axe serious/critical clean`, async ({ page }) => {
        await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
        await open(page, entry);
        await page.evaluate(() => document.fonts.ready);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
        const { violations } = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
        const blocking = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
        expect(blocking.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
      });
    }
  }
});

test.describe("layout stability with motion on", () => {
  for (const entry of [PAGES[0], PAGES[1]]) {
    for (const width of [375, 1440] as const) {
      test(`${entry.name} @${width}px: cumulative layout shift stays under 0.1`, async ({ page }) => {
        await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
        await page.addInitScript(() => {
          const w = window as unknown as { __cls: number };
          w.__cls = 0;
          new PerformanceObserver((list) => {
            for (const e of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) if (!e.hadRecentInput) w.__cls += e.value;
          }).observe({ type: "layout-shift", buffered: true });
        });
        await open(page, entry);
        await settle(page);
        const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
        expect(cls).toBeLessThan(0.1);
      });
    }
  }
});

test.describe("forecast data viz", () => {
  test("bars grow once the chart is in view; a Today rule and per-state totals label the chart", async ({ page }) => {
    await open(page, PAGES[0]);
    const chart = page.getByTestId("forecast-chart");
    await chart.scrollIntoViewIfNeeded();
    await expect(chart).toHaveAttribute("data-inview", "true");
    await expect(chart.locator(".recharts-reference-line")).toHaveCount(1);
    await expect(chart.getByText("Today")).toBeVisible();
    await expect(page.locator("figcaption").filter({ hasText: "Today, the demo clock" }).first()).toBeVisible();
    await settle(page);
    const t = await chart.locator(".recharts-bar-rectangle path").first().evaluate((el) => getComputedStyle(el).transform);
    expect(["none", "matrix(1, 0, 0, 1, 0, 0)"]).toContain(t);
  });

  test("hovering a table month highlights it in the chart, and hovering a chart month marks the table", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, PAGES[0]);
    await settle(page);
    // Bars are scaleY(0) (not visible, so not hoverable) until the chart has scrolled into view once. settle() scrolls
    // before hydration can attach the observer on a slow run, so bring the chart into view and wait for the flag the
    // component sets, then for the grow to finish, before aiming a pointer at a bar.
    const chart = page.getByTestId("forecast-chart");
    await chart.scrollIntoViewIfNeeded();
    await expect(chart).toHaveAttribute("data-inview", "true");
    await finishAnimations(page);
    const tbody = page.getByTestId("forecast-table").locator("tbody[data-month]").first();
    const month = await tbody.getAttribute("data-month");
    await expect(async () => {
      await tbody.hover();
      const dimmed = await page.getByTestId("forecast-chart").locator(".recharts-bar-rectangle path").evaluateAll((els) => els.filter((e) => getComputedStyle(e).opacity !== "1").length);
      expect(dimmed).toBeGreaterThan(0);
    }).toPass({ timeout: 15_000 });

    const bar = page.getByTestId("forecast-chart").locator(".recharts-bar-rectangle path").first();
    await expect(async () => {
      await bar.hover();
      await expect(page.getByTestId("forecast-table").locator("tbody[data-hl]")).toHaveCount(1, { timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
    await expect(page.getByTestId("forecast-table").locator("tbody[data-hl]")).toHaveAttribute("data-month", month!);
  });

  test("headline totals keep their exact value in the DOM for readers", async ({ page }) => {
    await open(page, PAGES[0]);
    await expect(page.getByTestId("forecast-stats").locator(".sr-only").first()).toHaveText(/^\$\d{1,3}(,\d{3})*$/);
  });
});

test.describe("activity day strip", () => {
  test("states its window and aggregation, and a day links to that day alone", async ({ page }) => {
    await open(page, PAGES[1]);
    const strip = page.getByTestId("activity-strip");
    await expect(strip).toBeVisible();
    await expect(strip.getByRole("heading")).toContainText(/\d+ entr(y|ies) (on \w{3} \d{1,2}, by hour|from \w{3} \d{1,2} to \w{3} \d{1,2}, by day)/);
    // A demo seed lands on one real day, so the strip is hourly (activity-strip-hour); a spread-out record is daily.
    const hourly = (await strip.getAttribute("data-mode")) === "hours";
    const day = strip.getByTestId(hourly ? "activity-strip-hour" : "activity-strip-day").last();
    await expect(day).toHaveAttribute("href", /from=(\d{4}-\d{2}-\d{2})&to=\1/);
    const label = (await day.getAttribute("aria-label")) ?? "";
    const n = hourly
      ? Number(/^(\d+)/.exec((await strip.getByRole("heading").innerText()).trim())?.[1])
      : Number(/: (\d+) entr/.exec(label)?.[1]);
    expect(n).toBeGreaterThan(0);
    // Slice 6: a plain click on a day already in the loaded feed scrolls to it; the href still filters to that day.
    await page.goto((await day.getAttribute("href"))!);
    await expect(page).toHaveURL(/from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}/);
    await expect(page.getByTestId("activity-entry").first()).toBeVisible();
    expect(await page.getByTestId("activity-entry").count()).toBe(Math.min(n, 50));
  });

  test("the strip agrees with the kind filter", async ({ page }) => {
    await page.goto("/activity?kind=ingestion");
    await expect(page.getByTestId("activity-entry").first()).toBeVisible();
    const entries = await page.getByTestId("activity-entry").count();
    await expect(page.getByTestId("activity-strip").getByRole("heading")).toContainText(new RegExp(`^${entries} entr`));
  });
});

test.describe("identifiers and confirmations", () => {
  test("copying an eval case id gives visible and announced feedback", async ({ page, context, baseURL }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: baseURL });
    await open(page, PAGES[4]);
    const copy = page.getByRole("button", { name: /^Copy case id / }).first();
    await expect(copy).toBeVisible();
    const id = ((await copy.getAttribute("aria-label")) ?? "").replace(/^Copy case id /, "");
    await expect(async () => {
      await copy.click();
      await expect(copy).toHaveAttribute("data-copied", "true", { timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
    await expect(copy).toContainText("Copied");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(id);
    expect(await copy.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/mono/i);
  });

  test("a CSV import ends in a confirmation with proportional, tabular counts", async ({ page }) => {
    await open(page, PAGES[3]);
    const csv = [
      "kind,number,payee_name,payee_address,payee_city,payee_state,payee_zip,amount,issue_date,voided,memo",
      "vendor_check,99501,Motion Test Supply,1 Main St,Austin,TX,78701,12.34,2026-09-01,false,motion e2e",
    ].join("\n");
    await page.locator("input[type=file]").setInputFiles({ name: "motion.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    await expect(async () => {
      await page.getByRole("button", { name: "Suggest mapping" }).click();
      await expect(page.getByRole("button", { name: "Confirm mapping and import" })).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
    await page.getByRole("button", { name: "Confirm mapping and import" }).click();
    const result = page.getByTestId("import-result");
    await expect(result).toBeVisible({ timeout: 120_000 });
    await expect(result).toContainText(/Imported 1 row from motion\.csv|Nothing new imported from motion\.csv/);
    const dd = page.getByTestId("import-counts").locator("dd").first();
    expect(await dd.evaluate((el) => getComputedStyle(el).fontFamily)).not.toMatch(/mono/i);
    expect(await dd.evaluate((el) => getComputedStyle(el).fontVariantNumeric)).toContain("tabular-nums");
  });

  test("a saved merge shows what changed and highlights the surviving payee", async ({ page }) => {
    await page.goto("/payees?show=all");
    await expect(page.getByTestId("payee-row").first()).toBeVisible();
    const quiet = page.getByTestId("quiet-duplicates");
    await quiet.locator("summary").click();
    const pair = page.getByTestId("quiet-pair").first();
    await expect(pair).toBeVisible();
    const dialog = page.getByTestId("payee-change-dialog");
    await expect(async () => {
      await pair.getByRole("button", { name: /Review merge/ }).click();
      await expect(dialog).toBeVisible({ timeout: 1_500 });
    }).toPass({ timeout: 20_000 });
    await expect(dialog.getByTestId("payee-change-confirm")).toBeVisible({ timeout: 15_000 });
    const keepName = /Keep (.+) as the canonical name/.exec((await dialog.getByTestId("merge-direction").textContent()) ?? "")?.[1] ?? "";
    expect(keepName).not.toBe("");
    await dialog.getByTestId("payee-change-name").fill("E2E Motion Reviewer");
    await dialog.getByTestId("payee-change-confirm").click();
    const notice = page.getByTestId("payee-notice");
    await expect(notice).toBeVisible({ timeout: 30_000 });
    await expect(notice).toContainText(/^Merged “.+” into “.+”/);
    await expect(notice).toContainText("recorded as a human decision");
    // The survivor is highlighted when it is on this page of the table (it may sit on another page).
    // Counting the survivor's row first races the table refresh, so check the flash itself: at most one row, and the survivor.
    const flashed = page.locator("[data-testid='payee-row'][data-flash]");
    expect(await flashed.count()).toBeLessThanOrEqual(1);
    if ((await flashed.count()) === 1) await expect(flashed).toContainText(keepName);
    await notice.getByRole("button", { name: "Dismiss confirmation" }).click();
    await expect(notice).toHaveCount(0);
  });
});
