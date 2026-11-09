/**
 * V4 "Tidewell glass" foundation (docs/DESIGN-V4.md): the navy/cream/coral reskin, the fixed backdrop with the ribbed
 * glass texture, the floating glass top bar with the centred pill nav, and the dashboard stage.
 *
 * On /dashboard, /items, /approvals, /ledger, /horizon, /activity, /rules and /login: axe (legacy mode) has no serious
 * or critical issues at 1440 and 375, there is no horizontal overflow at 375/1024/1440, the h1 is cream, and the
 * backdrop + ribbed texture exist, are aria-hidden and never take pointer events. The pill nav marks the active section
 * and every one of its links resolves; the primary CTA is coral. Screenshots: .data/shots/v4/<page>-<width>.png.
 * Read-only. Runs with reduced motion so screenshots and contrast are measured on final frames.
 */
import { mkdirSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "playwright/test";

const SHOTS = ".data/shots/v4";
const WIDTHS = [375, 1024, 1440] as const;
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const DISCLAIMER = "Prototype. Not legal advice. Confirm filings with a qualified professional.";

const APP_PAGES = [
  { name: "dashboard", path: "/dashboard", section: "overview" },
  { name: "items", path: "/items", section: "work" },
  { name: "approvals", path: "/approvals", section: "approvals" },
  { name: "ledger", path: "/ledger", section: "books" },
  { name: "horizon", path: "/horizon", section: "work" },
  { name: "activity", path: "/activity", section: "work" },
  { name: "rules", path: "/rules", section: "setup" },
] as const;

type Rgb = [number, number, number];

function rgb(css: string): Rgb {
  const m = css.match(/[\d.]+/g);
  if (!m || m.length < 3) throw new Error(`not an rgb colour: ${css}`);
  return [Number(m[0]), Number(m[1]), Number(m[2])];
}

/** Cream #F4EDE0 within a small tolerance: light, warm (red >= blue). */
function isCream([r, g, b]: Rgb): boolean {
  return r > 225 && g > 215 && b > 195 && r >= b;
}

/** Coral #FF6B5B (or its hover step #FF8E80). */
function isCoral([r, g, b]: Rgb): boolean {
  return r > 240 && g > 90 && g < 160 && b > 75 && b < 145;
}

async function open(page: Page, path: string, width: number) {
  await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
  await page.goto(path, { timeout: 120_000 });
  await expect(page.locator("h1").first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(DISCLAIMER).first()).toBeVisible();
  await page.waitForLoadState("networkidle").catch(() => undefined);
}

async function axeBlocking(page: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page }).setLegacyMode(true).withTags(WCAG_TAGS).analyze();
  return violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}: ${v.nodes.slice(0, 4).map((n) => `${n.target.join(" ")} ${n.failureSummary?.split("\n")[1] ?? ""}`).join(" | ")}`);
}

async function overflowX(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

async function expectAtmosphere(page: Page) {
  const backdrop = page.getByTestId("app-backdrop");
  const ribbed = page.getByTestId("ribbed-glass");
  await expect(backdrop).toBeAttached();
  await expect(ribbed).toBeAttached();
  for (const el of [backdrop, ribbed]) {
    await expect(el).toHaveAttribute("aria-hidden", "true");
    expect(await el.evaluate((e) => getComputedStyle(e).pointerEvents)).toBe("none");
  }
  const look = await ribbed.evaluate((e) => ({ img: getComputedStyle(e).backgroundImage, pos: getComputedStyle(e.parentElement!).position }));
  expect(look.img).toContain("repeating-linear-gradient");
  expect(look.pos).toBe("fixed");
}

async function expectCreamH1(page: Page) {
  const color = await page.locator("h1").first().evaluate((h) => getComputedStyle(h).color);
  expect(isCream(rgb(color)), `h1 colour ${color}`).toBe(true);
}

test.use({ reducedMotion: "reduce" });
test.describe.configure({ mode: "serial", timeout: 240_000 });
test.beforeAll(() => mkdirSync(SHOTS, { recursive: true }));

for (const p of APP_PAGES) {
  test(`${p.name}: atmosphere, cream h1, pill nav, axe clean and no overflow`, async ({ page }) => {
    await open(page, p.path, 1440);
    await expectAtmosphere(page);
    await expectCreamH1(page);

    // Pill nav: present, the page's section is the active inner pill with the coral dot.
    const nav = page.getByRole("navigation", { name: "Sections" });
    await expect(nav).toBeVisible();
    const active = nav.locator("a[aria-current='page']");
    await expect(active).toHaveCount(1);
    await expect(active).toHaveAttribute("data-testid", `pill-nav-${p.section}`);
    await expect(active.getByTestId("pill-nav-dot")).toBeVisible();
    const dot = await active.getByTestId("pill-nav-dot").evaluate((d) => getComputedStyle(d).backgroundColor);
    expect(isCoral(rgb(dot)), `active dot ${dot}`).toBe(true);
    // The rail keeps every page reachable.
    // No rail: the menu button opens every page, grouped.
    await expect(page.getByRole("complementary", { name: "Sidebar" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Open navigation/ })).toBeVisible();

    expect(await axeBlocking(page), `${p.name} axe @1440`).toEqual([]);
    expect(await overflowX(page), `${p.name} overflow @1440`).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `${SHOTS}/${p.name}-1440.png` });

    await page.setViewportSize({ width: 1024, height: 900 });
    expect(await overflowX(page), `${p.name} overflow @1024`).toBeLessThanOrEqual(0);

    await page.setViewportSize({ width: 375, height: 812 });
    await expect(page.getByRole("button", { name: /^Open navigation/ })).toBeVisible();
    expect(await overflowX(page), `${p.name} overflow @375`).toBeLessThanOrEqual(0);
    expect(await axeBlocking(page), `${p.name} axe @375`).toEqual([]);
    await page.screenshot({ path: `${SHOTS}/${p.name}-375.png` });
  });
}

test("pill nav: every section link resolves", async ({ page, request }) => {
  await open(page, "/dashboard", 1440);
  const hrefs = await page.getByRole("navigation", { name: "Sections" }).locator("a").evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""));
  expect(hrefs.length).toBeGreaterThanOrEqual(4);
  expect(hrefs.length).toBeLessThanOrEqual(6);
  for (const href of hrefs) {
    const r = await request.get(href, { maxRedirects: 0 });
    expect(r.status(), href).toBeLessThan(400);
  }
});

test("dashboard stage: coral primary CTA, booking-style deadline panel, feature strip with the coral bar", async ({ page }) => {
  await open(page, "/dashboard", 1440);
  const stage = page.getByTestId("dash-stage");
  await expect(stage).toBeVisible();
  const cta = page.getByTestId("hero-cta");
  await expect(cta).toBeVisible();
  const ctaBg = await cta.evaluate((a) => getComputedStyle(a).backgroundColor);
  expect(isCoral(rgb(ctaBg)), `primary CTA ${ctaBg}`).toBe(true);
  await expect(page.getByTestId("hero-ghost")).toBeVisible();

  const panel = page.getByTestId("hero-deadlines");
  await expect(panel).toBeVisible();
  const rows = panel.getByTestId("hero-deadline");
  expect(await rows.count()).toBeLessThanOrEqual(2);
  if ((await rows.count()) > 0) await expect(rows.first()).toContainText(/\d+ days?|Due today/);

  const strip = page.getByTestId("feature-strip");
  await expect(strip.locator("li")).toHaveCount(5);
  const bar = await strip.getByTestId("feature-bar").evaluate((b) => getComputedStyle(b).backgroundColor);
  expect(isCoral(rgb(bar)), `feature bar ${bar}`).toBe(true);
  // The hero sits straight on the backdrop: no box, no border.
  const stageBorder = await page.getByTestId("dash-stage").evaluate((el) => getComputedStyle(el).borderTopWidth);
  expect(stageBorder).toBe("0px");

  // The hero is the first thing under the top bar and fills (about) the first viewport.
  const box = await stage.boundingBox();
  expect(box, "stage box").not.toBeNull();
  expect(box!.y, "stage starts right under the top bar").toBeLessThan(110);
  expect(box!.y + box!.height, "stage reaches the bottom of the first viewport").toBeGreaterThan(900 * 0.9);
  // The page's own header is gone (sr-only h1), the overdue band and the Core loop strip sit below the hero.
  await expect(page.locator("main h1")).toHaveText("Dashboard");
  await expect(page.getByTestId("loop-slot").getByTestId("loop-bar")).toBeVisible();
  const overdue = page.getByTestId("overdue-panel");
  if ((await overdue.count()) > 0) {
    const below = await overdue.evaluate((el) => el.getBoundingClientRect().top);
    expect(below).toBeGreaterThan(box!.y + box!.height - 1);
  }
  await page.screenshot({ path: `${SHOTS}/dashboard-1440-full.png`, fullPage: true });
});

test("menu sheet: no rail, every page grouped Work / Books / Setup / Agents, with the company and Collapse", async ({ page }) => {
  for (const width of [1440, 375] as const) {
    await open(page, "/items", width);
    await expect(page.getByRole("complementary", { name: "Sidebar" })).toHaveCount(0);
    await page.getByRole("button", { name: /^Open navigation/ }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();
    for (const g of ["Work", "Books", "Setup", "Agents"]) await expect(sheet.getByText(g, { exact: true })).toBeVisible();
    for (const href of ["/dashboard", "/items", "/payees", "/approvals", "/forecast", "/horizon", "/what-if", "/activity", "/ledger", "/audit", "/rules", "/reports", "/recoveries", "/chat", "/runs", "/theater", "/eval", "/settings/integrations"]) {
      await expect(sheet.locator(`nav[aria-label="Main navigation"] a[href="${href}"]`), href).toHaveCount(1);
    }
    await expect(sheet.getByTitle("Single demo company")).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Collapse menu" })).toBeVisible();
    expect(await axeBlocking(page), `menu axe @${width}`).toEqual([]);
    await page.screenshot({ path: `${SHOTS}/menu-${width}.png` });
    await sheet.locator('a[href="/ledger"]').click();
    await expect(page).toHaveURL(/\/ledger$/);
    await expect(sheet).toBeHidden();
  }
});

test.describe("login", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("login: atmosphere, cream h1, coral submit, axe clean and no overflow", async ({ page }) => {
    await open(page, "/login", 1440);
    await expectAtmosphere(page);
    await expectCreamH1(page);
    const submit = page.getByRole("button", { name: /sign in|enter|continue/i }).first();
    await expect(submit).toBeVisible();
    const bg = await submit.evaluate((b) => getComputedStyle(b).backgroundColor);
    expect(isCoral(rgb(bg)), `login submit ${bg}`).toBe(true);
    expect(await axeBlocking(page), "login axe @1440").toEqual([]);
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
      expect(await overflowX(page), `login overflow @${width}`).toBeLessThanOrEqual(0);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.screenshot({ path: `${SHOTS}/login-1440.png` });
    await page.setViewportSize({ width: 375, height: 812 });
    expect(await axeBlocking(page), "login axe @375").toEqual([]);
    await page.screenshot({ path: `${SHOTS}/login-375.png` });
  });
});
