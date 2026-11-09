/**
 * Lifecycle rail polish, "ui" group: the core LifecycleRail on the dashboard's featured check and in the item drawer
 * (#10482, rail view) at 375 / 1024 / 1440. No two label boxes overlap, every label lies inside the rail's box, the
 * page never scrolls sideways, axe serious/critical is clean, and the screen-reader table prints human dates (R3-12).
 * Writes .data/shots/v3-lifecycle-{375,1024,1440}.png and v3-lifecycle-drawer-1440.png. Read-only.
 */
import { mkdirSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { waitForFlowLayout } from "./animations";
import { expect, test, type Locator, type Page } from "playwright/test";
import { openDashboardDetail } from "./dashboard-detail";

const DISCLAIMER = "Prototype. Not legal advice. Confirm filings with a qualified professional.";
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const SHOTS = ".data/shots";
const WIDTHS = [375, 1024, 1440] as const;
const ISO = /\b\d{4}-\d{2}-\d{2}\b/;

async function axeBlocking(page: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page }).setLegacyMode(true).withTags(WCAG_TAGS).analyze();
  return violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
}

async function overflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

/** Fonts loaded and finite animations done (infinite loops elsewhere on the page are skipped). */
async function settle(page: Page) {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await waitForFlowLayout(page); // cards mount after hydration; collect their reveal animations too
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    );
  });
}

interface RailReport {
  orientation: string | null;
  labels: number;
  overlaps: string[];
  outside: string[];
  srText: string;
  srRows: number;
}

/** Geometry of one rendered rail: label boxes from the DOM (real glyph widths, not the model's estimate). */
async function inspect(rail: Locator): Promise<RailReport> {
  return rail.evaluate((fig) => {
    const box = fig.querySelector("[data-testid=lifecycle-box]")!.getBoundingClientRect();
    const els = [...fig.querySelectorAll("[data-testid=lifecycle-label]")].filter((e) => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    const rects = els.map((e) => ({ key: e.getAttribute("data-key") ?? "?", r: e.getBoundingClientRect() }));
    const overlaps: string[] = [];
    const tol = 0.5;
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i]!.r;
        const b = rects[j]!.r;
        if (a.left < b.right - tol && b.left < a.right - tol && a.top < b.bottom - tol && b.top < a.bottom - tol) overlaps.push(`${rects[i]!.key} x ${rects[j]!.key}`);
      }
    }
    const outside = rects
      .filter(({ r }) => r.left < box.left - 1 || r.right > box.right + 1 || r.top < box.top - 1 || r.bottom > box.bottom + 1)
      .map(({ key, r }) => `${key} [${Math.round(r.left)}..${Math.round(r.right)}] vs box [${Math.round(box.left)}..${Math.round(box.right)}]`);
    const table = fig.querySelector(".sr-only table");
    return {
      orientation: fig.getAttribute("data-orientation"),
      labels: rects.length,
      overlaps,
      outside,
      srText: table?.textContent ?? "",
      srRows: table?.querySelectorAll("tbody tr").length ?? 0,
    };
  });
}

function expectClean(r: RailReport, width: number) {
  expect(r.orientation).toBe(width < 600 ? "vertical" : r.orientation);
  expect(["horizontal", "vertical"]).toContain(r.orientation);
  expect(r.labels).toBeGreaterThanOrEqual(3);
  expect(r.overlaps, "overlapping labels").toEqual([]);
  expect(r.outside, "labels outside the rail box").toEqual([]);
  expect(r.srRows).toBeGreaterThanOrEqual(3);
  expect(r.srText, "sr table has no ISO dates").not.toMatch(ISO);
  expect(r.srText).toMatch(/[A-Z][a-z]{2} \d{1,2}, \d{4}/);
}

test.describe.configure({ mode: "default", timeout: 150_000 });
test.beforeAll(() => mkdirSync(SHOTS, { recursive: true }));

test.describe("lifecycle rail: dashboard featured check", () => {
  for (const width of WIDTHS) {
    test(`@${width}: labels never overlap or clip, no page overflow, axe clean, human dates`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
      await page.goto("/dashboard", { timeout: 90_000 });
      await expect(page.getByText(DISCLAIMER)).toBeVisible({ timeout: 30_000 });
      await openDashboardDetail(page);
      const card = page.getByRole("region", { name: "Featured item" });
      await expect(card).toContainText("#10482", { timeout: 30_000 });
      const rail = page.getByTestId("featured-timeline").getByTestId("lifecycle-rail");
      await rail.scrollIntoViewIfNeeded();
      await expect(rail).not.toHaveAttribute("data-orientation", "pending");
      await settle(page);

      const r = await inspect(rail);
      expectClean(r, width);
      // The 1440 card is wide enough for the horizontal rail; narrower cards (375, the 1024 grid column) get the list.
      if (width === 1440) expect(r.orientation).toBe("horizontal");
      await expect(rail.getByText("TODAY", { exact: true }).first()).toBeVisible();
      if (r.orientation === "vertical") {
        // Every stage is listed (none cut off at the card edge).
        await expect(rail.getByTestId("lifecycle-label")).toHaveCount(r.srRows + 1);
      }
      await expect(rail.getByText("UNVERIFIED").first()).toBeVisible();
      expect(await overflow(page)).toBeLessThanOrEqual(0);
      await card.screenshot({ path: `${SHOTS}/v3-lifecycle-${width}.png` });
      expect(await axeBlocking(page)).toEqual([]);
    });
  }
});

test.describe("lifecycle rail: item drawer (#10482, rail view)", () => {
  for (const width of WIDTHS) {
    test(`@${width}: the drawer rail is clean and complete`, async ({ page }) => {
      await page.addInitScript(() => localStorage.setItem("es-lifecycle-view", "rail"));
      await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
      await page.goto("/items?item=10482", { timeout: 90_000 });
      const drawer = page.getByTestId("item-drawer");
      await expect(drawer.getByTestId("item-lifecycle")).toHaveAttribute("data-view", "rail", { timeout: 30_000 });
      await expect(page.getByText(DISCLAIMER).first()).toBeAttached();
      const rail = drawer.getByRole("figure", { name: "Lifecycle" });
      await rail.scrollIntoViewIfNeeded();
      await expect(rail).not.toHaveAttribute("data-orientation", "pending");
      await settle(page);

      const r = await inspect(rail);
      expectClean(r, width);
      expect(await overflow(page)).toBeLessThanOrEqual(0);
      if (width === 1440) await page.screenshot({ path: `${SHOTS}/v3-lifecycle-drawer-1440.png` });
      expect(await axeBlocking(page)).toEqual([]);
    });
  }
});
