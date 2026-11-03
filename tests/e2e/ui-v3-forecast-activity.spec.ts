/**
 * DESIGN-V3 slice 6 (forecast, activity, recoveries), "ui" group: the deadline river renders real engine deadlines from
 * the demo clock, a strip day scrolls the activity feed to that day, the kind chips filter, the recovery flow renders from
 * stored recoveries (after a real scripted search when none exist yet), axe is clean, and nothing overflows at
 * 375/1024/1440. Runs under reduced motion, so every viz is on its static render tier.
 *   E2E_PORT=3489 E2E_DIR_SUFFIX=-v3fa CI=1 pnpm exec playwright test tests/e2e/ui-v3-forecast-activity.spec.ts --project ui
 * Writes .data/shots/v3-{forecast,activity,recoveries}-{1440,375}.png.
 */
import { mkdirSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "playwright/test";

const DISCLAIMER = "Prototype. Not legal advice. Confirm filings with a qualified professional.";
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const SHOTS = ".data/shots";
const WIDTHS = [375, 1024, 1440] as const;

test.use({ reducedMotion: "reduce" });
test.beforeAll(() => mkdirSync(SHOTS, { recursive: true }));
test.beforeEach(({}, info) => test.skip(info.project.name !== "ui", "runs in the ui project only"));
test.describe.configure({ mode: "serial", timeout: 180_000 });

async function axeBlocking(page: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page }).setLegacyMode(true).withTags(WCAG_TAGS).analyze();
  return violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
}

async function overflow(page: Page): Promise<number> {
  await page.evaluate(() => document.fonts.ready);
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

/** The elements that stick out past the viewport's right edge, for the overflow failure message. */
function widest(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    // Descend from <body> into whichever child, when hidden, removes the overflow: the path names the culprit.
    const over = () => document.documentElement.scrollWidth - document.documentElement.clientWidth;
    const path: string[] = [];
    let node: Element = document.body;
    for (let depth = 0; depth < 40; depth++) {
      const next = [...node.children].find((c) => {
        const el = c as HTMLElement;
        const prev = el.style.display;
        el.style.display = "none";
        const fixed = over() <= 0;
        el.style.display = prev;
        return fixed;
      });
      if (!next) break;
      path.push(`${next.tagName.toLowerCase()}.${(next.getAttribute("class") ?? "").slice(0, 60)} [${(next as HTMLElement).dataset?.testid ?? ""}]`);
      node = next;
    }
    return path;
  });
}

const PAGES = [
  { name: "forecast", path: "/forecast", ready: (p: Page) => p.getByTestId("deadline-river") },
  { name: "activity", path: "/activity", ready: (p: Page) => p.getByTestId("activity-entry").first() },
  { name: "recoveries", path: "/recoveries", ready: (p: Page) => p.getByTestId("recovery-flow") },
] as const;

test.describe("forecast: deadline river", () => {
  test("renders real engine deadlines from the demo clock, stacked by kind, with the 7-day window and a tooltip", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/forecast", { timeout: 90_000 });
    const river = page.getByTestId("deadline-river");
    await expect(river).toBeVisible({ timeout: 30_000 });
    await expect(river).not.toHaveAttribute("data-empty", "true");
    await expect(page.getByTestId("forecast-window")).toContainText("Nov 1, 2026 (demo clock)");
    await expect(river).toContainText("Today, the demo clock (Nov 1, 2026)");

    const cols = river.getByTestId("river-column");
    expect(await cols.count()).toBeGreaterThan(0);
    const dates = await cols.evaluateAll((els) => els.map((e) => e.getAttribute("data-date") ?? ""));
    expect(dates.every((d) => d >= "2026-11-01" && d < "2027-11-01")).toBe(true);
    expect(dates).toEqual([...dates].sort());
    // every segment is one of the four engine kinds, and stacks bottom up in kind order
    const kinds = await cols.first().locator("rect[data-kind]").evaluateAll((els) => els.map((e) => e.getAttribute("data-kind")));
    expect(kinds.length).toBeGreaterThan(0);
    const order = ["presumed_abandoned", "dd_window_opens", "report_due", "remit_due"];
    expect(kinds.map((k) => order.indexOf(k!))).toEqual([...kinds.map((k) => order.indexOf(k!))].sort((a, b) => a - b));
    // the static tier under reduced motion: no grow or ping animation classes
    await expect(river.locator(".es-grow-y")).toHaveCount(0);
    await expect(river.getByTestId("river-today")).not.toHaveClass(/es-ping-once/);

    // tooltip on focus and on hover
    await cols.first().focus();
    await expect(page.getByRole("tooltip")).toBeVisible();
    await expect(page.getByRole("tooltip")).toContainText(/item/);
    await page.keyboard.press("Tab");
    await cols.nth(Math.min(1, (await cols.count()) - 1)).hover();
    await expect(page.getByRole("tooltip")).toBeVisible();

    // the river scrolls inside its own region, not the page
    const region = page.getByRole("region", { name: /Deadline river/ });
    const sw = await region.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(sw).toBeGreaterThan(0);

    // the hidden table carries every number; calendar rows and the ICS button stay
    await expect(river.locator("table.sr-only tbody tr")).not.toHaveCount(0);
    await expect(page.getByTestId("calendar-row").first()).toBeVisible();
    await expect(page.getByTestId("add-to-calendar").first()).toHaveAttribute("href", /\/api\/calendar\.ics/);
    await expect(page.getByTestId("forecast-chart")).toBeVisible();
    await expect(page.getByText(DISCLAIMER)).toBeVisible();
  });
});

test.describe("activity: seismograph and feed", () => {
  test("clicking a strip day scrolls the feed to that day without leaving the page", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 800 });
    await page.goto("/activity", { timeout: 90_000 });
    await expect(page.getByTestId("activity-entry").first()).toBeVisible({ timeout: 30_000 });
    const inFeed = page.locator('[data-testid="activity-strip-day"][data-in-feed]');
    expect(await inFeed.count()).toBeGreaterThan(0);
    const day = inFeed.first(); // the oldest day still in the loaded feed: furthest down
    const iso = (await day.getAttribute("data-day"))!;
    const url = page.url();

    await day.click();
    const section = page.locator(`#activity-day-${iso}`);
    await expect(section).toBeInViewport();
    await expect(section).toBeFocused();
    expect(page.url()).toBe(url);
    await expect(day).toHaveAttribute("aria-current", "location");

    // the strip's hidden table, and the real-clock label next to recorded times
    await expect(page.getByTestId("activity-strip").locator("table.sr-only tbody tr")).toHaveCount(30);
    await expect(page.getByTestId("activity-clock-note")).toContainText("real clock");
  });

  test("the kind chips filter the feed through the URL", async ({ page }) => {
    await page.goto("/activity", { timeout: 90_000 });
    const chips = page.getByRole("navigation", { name: "Kind" });
    await expect(chips).toBeVisible({ timeout: 30_000 });
    await chips.getByRole("link", { name: /^Ingestion/ }).click();
    await expect(page).toHaveURL(/kind=ingestion/);
    await expect(page.getByTestId("activity-entry").first()).toBeVisible();
    const kinds = await page.getByTestId("activity-entry").evaluateAll((els) => els.map((e) => e.getAttribute("data-kind")));
    expect(new Set(kinds)).toEqual(new Set(["ingestion"]));
    await expect(chips.locator('[data-kind="ingestion"]')).toHaveAttribute("aria-current", "true");
    await expect(page.getByTestId("activity-export")).toHaveAttribute("href", /kind=ingestion/);

    // second chip adds a kind; "All kinds" clears
    await chips.getByRole("link", { name: /^Agent run/ }).click();
    await expect(page).toHaveURL(/kind=run%2Cingestion|kind=ingestion%2Crun|kind=run,ingestion/);
    await chips.getByRole("link", { name: "All kinds" }).click();
    await expect(page).not.toHaveURL(/kind=/);
  });
});

test.describe("recoveries: recovery flow", () => {
  test("renders from stored recoveries only, after a real scripted search when none exist", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/recoveries", { timeout: 90_000 });
    const flow = page.getByTestId("recovery-flow");
    await expect(flow).toBeVisible({ timeout: 30_000 });
    if ((await flow.getAttribute("data-empty")) === "true") {
      await expect(flow).toContainText("No recoveries recorded yet");
      await page.getByTestId("run-recovery-btn").click();
      // The scripted search writes its rows when it finishes; the page reads them on the next server render.
      await expect(page.getByText(/Recovery search complete|Search finished/)).toBeVisible({ timeout: 120_000 });
      await expect(async () => {
        await page.reload();
        await expect(page.getByTestId("recovery-card").first()).toBeVisible({ timeout: 5_000 });
      }).toPass({ timeout: 60_000 });
    }
    await expect(flow).not.toHaveAttribute("data-empty", "true", { timeout: 30_000 });
    const links = flow.getByTestId("recovery-flow-link");
    expect(await links.count()).toBeGreaterThan(0);
    await expect(flow.locator('[data-node="found"]')).toBeVisible();
    await expect(flow.locator('[data-node^="portal:"]').first()).toBeVisible();

    // conservation on screen: what leaves the portals is what arrives at Found
    const cents = (label: string | null) => Math.round(Number((/\$([\d,]+\.\d{2})/.exec(label ?? "")?.[1] ?? "NaN").replace(/,/g, "")) * 100);
    const portals = await flow.locator('[data-node^="portal:"]').evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
    const found = await flow.locator('[data-node="found"]').getAttribute("aria-label");
    expect(portals.reduce((a, l) => a + cents(l), 0)).toBe(cents(found));

    await links.first().focus();
    await expect(page.getByRole("tooltip")).toBeVisible();
    await expect(page.getByRole("tooltip")).toContainText("→");
    await expect(flow.locator("table.sr-only tbody tr")).toHaveCount(await links.count());
    // approve stays behind the gate: a claim needs a named approver before it can be filed
    const card = page.getByTestId("recovery-card").first();
    if (await card.getByTestId("approve-claim-btn").count()) await expect(card.getByTestId("file-claim-btn")).toHaveCount(0);
  });
});

test.describe("layout and a11y", () => {
  for (const p of PAGES) {
    for (const width of WIDTHS) {
      test(`${p.name}: no horizontal overflow and axe clean at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
        await page.goto(p.path, { timeout: 90_000 });
        await expect(p.ready(page)).toBeVisible({ timeout: 30_000 });
        await expect(page.getByText(DISCLAIMER)).toBeVisible();
        expect(await overflow(page), (await widest(page)).join("\n")).toBeLessThanOrEqual(0);
        expect(await axeBlocking(page)).toEqual([]);
        if (width !== 1024) await page.screenshot({ path: `${SHOTS}/v3-${p.name}-${width}.png`, fullPage: width === 1440 });
      });
    }
  }
});
