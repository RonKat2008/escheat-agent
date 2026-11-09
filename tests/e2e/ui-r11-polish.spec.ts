/**
 * Round-11 polish (R11-09..14):
 *   09 the Ask money-map preview: threads are drawn beneath the labels (flat on the floor), labels never overlap each other
 *   10 the Close card's tie-out fits at 375 (no clipped "Tie-out" column)
 *   11 coral means "a person must act": the active nav pill / mode segment is not coral
 *   13 the brand link is at least 24x24 at 375
 *   14 the dashboard deadlines card names only the states of the rows it shows
 * Axe (serious/critical) and no horizontal overflow at 375/1024/1440. Screenshots to .data/shots/r11polish/.
 */
import { mkdirSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test as base, type Page } from "playwright/test";
import { E2E_UI_PASSCODE } from "./env";
import { firstRunSeen } from "./first-run";

const test = base.extend({
  page: async ({ browser, baseURL }, provide) => {
    const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [firstRunSeen(baseURL!)] } });
    const page = await context.newPage();
    await page.goto("/login", { waitUntil: "load", timeout: 90_000 });
    await expect(page.getByLabel("Passcode")).toBeEditable();
    for (let i = 0; i < 5 && new URL(page.url()).pathname.startsWith("/login"); i++) {
      await page.getByLabel("Passcode").fill(E2E_UI_PASSCODE);
      await page.getByRole("button", { name: "Enter" }).click();
      await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20_000 }).catch(() => undefined);
    }
    await expect(page).not.toHaveURL(/\/login/);
    await provide(page);
    await context.close();
  },
});

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const SHOTS = ".data/shots/r11polish";
const WIDTHS = [375, 1024, 1440] as const;

test.describe.configure({ timeout: 180_000 });
test.beforeAll(() => mkdirSync(SHOTS, { recursive: true }));

async function axeBlocking(page: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page }).setLegacyMode(true).withTags(WCAG_TAGS).analyze();
  return violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.length}`);
}

async function overflowPx(page: Page): Promise<number> {
  await page.evaluate(() => document.fonts.ready);
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

async function openAsk(page: Page, width: number) {
  await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
  await page.goto("/ask", { timeout: 90_000 });
  await expect(page.getByTestId("chat-input")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("top-bar").getByTestId("mode-switch")).toHaveAttribute("data-ready", "true", { timeout: 60_000 });
}

const isCoralCss = (css: string) => {
  const [r = 0, g = 0, b = 0] = (css.match(/[\d.]+/g) ?? []).map(Number);
  return r > 200 && g > 70 && g < 160 && b > 60 && b < 140; // #FF6B5B family
};

for (const width of WIDTHS) {
  test(`Ask at ${width}: map threads sit beneath non-overlapping labels, nav is not coral, axe + overflow clean`, async ({ page }) => {
    await openAsk(page, width);
    const preview = page.getByTestId("ask-map-preview");
    const labels = preview.locator("[data-map-col]");
    await expect(labels.first()).toBeVisible();
    await expect.poll(() => labels.evaluateAll((els) => els.every((e) => Number(getComputedStyle(e).opacity) === 1)), { timeout: 10_000 }).toBe(true);

    // R11-09: labels never overlap one another, and the threads are the flat floor layer (no 3D arcs rising to a label).
    const boxes = await labels.evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => ({ l: r.left, t: r.top, r: r.right, b: r.bottom })));
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!;
        const b = boxes[j]!;
        const overlap = a.l < b.r - 1 && b.l < a.r - 1 && a.t < b.b - 1 && b.t < a.b - 1;
        expect(overlap, `labels ${i} and ${j} overlap at ${width}`).toBe(false);
      }
    await expect(preview.locator("[data-map-root] svg path[marker-end]").first()).toBeAttached();
    // Nothing the threads draw is stacked above a label in 3D: only the flat SVG layer carries them.
    expect(await preview.locator("[data-map-root] div[style*='rotateZ'][style*='rotateX(-90deg)']").count()).toBe(0);

    // R11-11: the active mode segment's indicator and the active section pill dot are steel, not coral.
    const bar = page.getByTestId("top-bar");
    const dots = await bar.locator("[data-testid='mode-ask'] span[aria-hidden], [data-testid^='pill-nav-dot']").evaluateAll((els) =>
      els.filter((e) => e.classList.contains("rounded-full")).map((e) => getComputedStyle(e).backgroundColor),
    );
    for (const d of dots) expect(isCoralCss(d), `nav dot ${d}`).toBe(false);

    // R11-13: the brand link is a real tap target at 375.
    if (width === 375) {
      const box = await bar.getByRole("link", { name: "Escheat Agent, dashboard" }).boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(24);
      expect(box!.height).toBeGreaterThanOrEqual(24);
    }

    expect(await overflowPx(page)).toBeLessThanOrEqual(0);
    expect(await axeBlocking(page)).toEqual([]);
    await page.screenshot({ path: `${SHOTS}/ask-${width}.png` });
  });
}

test("the active dashboard section pill is steel, not coral (R11-11)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/dashboard", { timeout: 90_000 });
  const dot = page.getByTestId("pill-nav-dot");
  await expect(dot).toBeVisible({ timeout: 30_000 });
  expect(isCoralCss(await dot.evaluate((d) => getComputedStyle(d).backgroundColor))).toBe(false);
});

test("Close card tie-out fits at 375 with nothing clipped (R11-10)", async ({ page }) => {
  await openAsk(page, 375);
  await page.getByTestId("chat-input").fill("Close the month");
  await page.getByTestId("chat-input").press("Enter");
  const last = page.getByTestId("chat-assistant-message").last();
  await expect(last).toHaveAttribute("data-status", "done", { timeout: 60_000 });
  const table = last.getByTestId("period-close-tieout");
  await expect(table).toBeVisible();
  const { scroll, client } = await table.evaluate((t) => ({ scroll: t.parentElement!.scrollWidth, client: t.parentElement!.clientWidth }));
  expect(scroll, "tie-out table wider than its box").toBeLessThanOrEqual(client);
  const head = table.getByRole("columnheader", { name: "Tie-out" });
  await head.scrollIntoViewIfNeeded();
  const hb = (await head.boundingBox())!;
  expect(hb.x + hb.width, "Tie-out header past the right edge").toBeLessThanOrEqual(375);
  expect(await overflowPx(page)).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `${SHOTS}/close-card-375.png` });
});

for (const width of WIDTHS) {
  test(`Dashboard at ${width}: the deadlines header names only the states its rows show (R11-14)`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
    await page.goto("/dashboard", { timeout: 90_000 });
    const panel = page.getByTestId("hero-deadlines");
    await expect(panel).toBeVisible({ timeout: 30_000 });
    const head = ((await panel.locator("p").first().textContent()) ?? "").trim();
    const rowStates = await panel.getByTestId("hero-deadline").evaluateAll((rows) =>
      rows.flatMap((r) => {
        const m = (r.textContent ?? "").match(/([A-Z]{2}) · \$/);
        return m ? [m[1]!] : [];
      }),
    );
    const headStates = (head.split(" · ")[1] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    expect([...new Set(headStates)].sort()).toEqual([...new Set(rowStates)].sort());
    expect(await overflowPx(page)).toBeLessThanOrEqual(0);
    expect(await axeBlocking(page)).toEqual([]);
    await page.screenshot({ path: `${SHOTS}/dashboard-${width}.png` });
  });
}
