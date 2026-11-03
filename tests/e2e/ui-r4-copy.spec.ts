/**
 * Round 4 copy slice (R4-17, R4-27): no developer jargon or raw ISO dates in user-facing text on the touched screens.
 * Raw ISO stays in machine fields (data attributes, dateTime, title tooltips), which innerText does not include.
 * Also checks the rule-version label (short human text, full string in the tooltip), axe, and no horizontal overflow.
 * Screenshots (R4_SHOTS_DIR, default .data/shots/r4-copy): 375 + 1440.
 */
import { mkdirSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "playwright/test";

const SHOTS = process.env.R4_SHOTS_DIR ?? ".data/shots/r4-copy";
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const PATHS = ["/", "/items", "/reports", "/eval", "/rules"];

const RAW_ISO = /\b\d{4}-\d{2}-\d{2}\b/;
const JARGON = [/\bpnpm\b/, /->/, /\+appr\./, /\d{8}T\d{6}/, /result row\(s\)/];

for (const width of [375, 1024, 1440]) {
  test(`touched screens have no raw ISO dates or jargon, are axe-clean and do not overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const path of PATHS) {
      await page.goto(path);
      await expect(page.locator("main, body").first()).toBeVisible();
      await expect(page.locator("h1, h2").first()).toBeVisible();
      await expect(page.getByLabel(/^Loading/)).toHaveCount(0);
      const text = await page.evaluate(() => document.body.innerText);
      expect(text, `${path} shows a raw ISO date`).not.toMatch(RAW_ISO);
      for (const re of JARGON) expect(text, `${path} shows ${re}`).not.toMatch(re);

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${path} overflows at ${width}px`).toBeLessThanOrEqual(0);

      const { violations } = await new AxeBuilder({ page }).setLegacyMode(true).withTags(WCAG_TAGS).analyze();
      const blocking = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(blocking.map((v) => `${v.id}: ${v.nodes[0]?.target}`), `${path} axe`).toEqual([]);

      if (width !== 1024) {
        mkdirSync(SHOTS, { recursive: true });
        await page.screenshot({ path: `${SHOTS}/${path === "/" ? "landing" : path.slice(1)}-${width}.png`, fullPage: false });
      }
    }
  });
}

test("rule versions read as short labels with the full string in the tooltip", async ({ page }) => {
  await page.goto("/reports");
  const labels = page.locator("[data-rule-version]");
  const n = await labels.count();
  test.skip(n === 0, "no rule version rendered on this seed");
  for (let i = 0; i < n; i++) {
    const el = labels.nth(i);
    const text = (await el.innerText()).trim();
    expect(text).toMatch(/rules v\d/);
    expect(text).not.toMatch(/appr\.|T\d{6}/);
    expect(await el.getAttribute("title")).toBe(await el.getAttribute("data-rule-version"));
  }
});

test("landing: the four steps carry distinct actor labels", async ({ page }) => {
  await page.goto("/");
  const chips = await page.locator(".vx-step .mkt-chip").allInnerTexts();
  expect(chips).toHaveLength(4);
  expect(new Set(chips.map((c) => c.trim())).size).toBe(4);
});
