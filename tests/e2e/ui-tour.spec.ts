/**
 * Judge tour (src/components/tour): an opt-in guided walk over the real demo path.
 *  - entries: the top-bar Tour link and the ⌘K "Take the 3-minute tour" command both open stop 1 (`?tour=1`);
 *  - walks every stop at 1440 (anchored popover) and 375 (bottom sheet) with →/← and the buttons; each stop lands on
 *    its real screen, finds its anchor, and every figure it shows is the page's own text at that moment;
 *  - `?tour=N` resumes on stop N's screen; Esc closes and drops the param; Tab stays inside the dialog;
 *  - reduced motion: no spotlight transition or pulse; axe (serious/critical) clean with the tour open; no horizontal
 *    overflow; the disclaimer stays visible in the tour itself.
 * Read-only: the tour never clicks Approve/Send/Run, so this spec leaves no residue.
 * Shots: $R4_SHOTS_DIR (default .data/shots/r4-tour) tour-<width>-<n>-<stop>.png.
 */
import { mkdirSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "playwright/test";

const DISCLAIMER = "Prototype. Not legal advice. Confirm filings with a qualified professional.";
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const SHOTS = process.env.R4_SHOTS_DIR ?? ".data/shots/r4-tour";
const STOPS = ["exposure", "money-flow", "item", "rules", "approvals", "close-out", "recoveries", "chat", "runs", "eval"] as const;
const PATHS: Record<(typeof STOPS)[number], RegExp> = {
  exposure: /^\/dashboard$/,
  "money-flow": /^\/dashboard$/,
  item: /^\/items$/,
  rules: /^\/rules$/,
  approvals: /^\/approvals$/,
  "close-out": /^\/close-out\/CA$/,
  recoveries: /^\/recoveries$/,
  chat: /^\/chat$/,
  runs: /^\/runs$/,
  eval: /^\/eval$/,
};
const SHOT_STOPS = new Set([1, 3, 4, 5]);

test.describe.configure({ mode: "serial", timeout: 420_000 });
test.beforeAll(() => mkdirSync(SHOTS, { recursive: true }));

const tour = (page: Page) => page.getByTestId("judge-tour");

async function atStop(page: Page, n: number) {
  const id = STOPS[n - 1] ?? "exposure";
  await expect(tour(page)).toHaveAttribute("data-index", String(n), { timeout: 90_000 });
  await expect(tour(page)).toHaveAttribute("data-step", id);
  await expect(tour(page)).toHaveAttribute("data-phase", "ready", { timeout: 90_000 });
  expect(new URL(page.url()).pathname).toMatch(PATHS[id]);
  expect(new URL(page.url()).searchParams.get("tour")).toBe(String(n));
  await expect(page.getByTestId("tour-counter")).toContainText(`${String(n).padStart(2, "0")} / ${String(STOPS.length).padStart(2, "0")}`);
  await expect(page.getByTestId("tour-disclaimer")).toHaveText(DISCLAIMER);
  await expect(page.getByTestId("tour-disclaimer")).toBeInViewport();
}

async function expectNoOverflow(page: Page) {
  const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  expect(sw, `horizontal overflow at ${iw}px`).toBeLessThanOrEqual(iw);
}

async function axeBlocking(page: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page }).setLegacyMode(true).withTags(WCAG_TAGS).analyze();
  return violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
}

/** Every readout the tour shows is text the page itself rendered (no invented figures). */
async function readoutsComeFromPage(page: Page) {
  const values = await page.getByTestId("tour-readout").allInnerTexts();
  for (const v of values) {
    const onPage = await page.evaluate((text) => {
      const root = document.getElementById("judge-tour-root");
      const norm = (s: string) => s.replace(/\s+/g, " ").trim();
      return Array.from(document.querySelectorAll<HTMLElement>("body *")).some((el) => !root?.contains(el) && norm(el.innerText ?? "") === norm(text));
    }, v);
    expect(onPage, `readout "${v}" is not text on the page`).toBe(true);
  }
}

async function walk(page: Page, width: number, how: "keys" | "buttons") {
  for (let n = 1; n <= STOPS.length; n++) {
    await atStop(page, n);
    await expect(tour(page)).toHaveAttribute("data-layout", width < 640 ? "sheet" : "popover");
    await expect(page.getByTestId("tour-next")).toBeFocused();
    await readoutsComeFromPage(page);
    await expectNoOverflow(page);
    if (n === 5) await expect(page.getByTestId("tour-human")).toContainText("You click Approve");
    if (SHOT_STOPS.has(n)) {
      await page.waitForTimeout(500); // let the spotlight settle for the screenshot
      await page.screenshot({ path: `${SHOTS}/tour-${width}-${n}-${STOPS[n - 1]}.png` });
    }
    if (n === STOPS.length) break;
    if (how === "keys") await page.keyboard.press("ArrowRight");
    else await page.getByTestId("tour-next").click();
  }
  await expect(page.getByTestId("tour-next")).toHaveText("Finish");
}

test("1440: walk every stop with the keyboard, back with ←, Esc closes", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const posts: string[] = [];
  page.on("request", (r) => {
    if (r.method() !== "GET" && r.url().includes("/api/")) posts.push(r.url());
  });
  await page.goto("/dashboard", { timeout: 90_000 });
  await page.getByTestId("tour-start").click();
  await walk(page, 1440, "keys");
  await page.keyboard.press("ArrowLeft");
  await atStop(page, STOPS.length - 1);
  await page.keyboard.press("Escape");
  await expect(tour(page)).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get("tour")).toBeNull();
  expect(posts, "the tour must not call any mutating API").toEqual([]);
});

test("375: bottom sheet, buttons, dots and Finish", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/dashboard?tour=1", { timeout: 90_000 });
  await walk(page, 375, "buttons");
  // Dots jump directly.
  await page.getByTestId("tour-dot").nth(1).click();
  await atStop(page, 2);
  await expect(page.getByTestId("tour-dot").nth(1)).toHaveAttribute("aria-current", "step");
  await page.getByTestId("tour-dot").nth(STOPS.length - 1).click();
  await atStop(page, STOPS.length);
  await page.getByTestId("tour-next").click();
  await expect(tour(page)).toHaveCount(0);
});

test("⌘K command starts the tour; ?tour=N resumes on that stop's screen", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/approvals", { timeout: 90_000 });
  const palette = page.getByTestId("command-palette");
  // The shortcut is live only after hydration; retry the key until the palette opens (as ui-v3-foundation does).
  await expect(async () => {
    await page.keyboard.press("ControlOrMeta+k");
    await expect(palette).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 30_000 });
  await palette.getByRole("combobox").fill("tour");
  await palette.getByRole("option", { name: /Take the 3-minute tour/ }).click();
  await atStop(page, 1);
  await page.goto("/runs?tour=3", { timeout: 90_000 });
  await atStop(page, 3);
  await expect(page.getByTestId("item-drawer")).toBeVisible();
  await expect(page.getByTestId("tour-readouts")).toContainText("#10087");
});

test("focus trap, aria-live narration, axe with the tour open, reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: width < 640 ? 812 : 900 });
    for (const n of [1, 3, 5]) {
      await page.goto(`/dashboard?tour=${n}`, { timeout: 90_000 });
      await atStop(page, n);
      const dialog = page.getByRole("dialog", { name: /.+/ }).filter({ has: page.getByTestId("tour-next") });
      await expect(dialog).toHaveAttribute("aria-modal", "true");
      await expect(page.getByTestId("tour-live")).toHaveAttribute("aria-live", "polite");
      await expect(page.getByTestId("tour-live")).toContainText(`Stop ${n} of ${STOPS.length}`);
      for (let i = 0; i < 16; i++) {
        await page.keyboard.press(i % 5 === 4 ? "Shift+Tab" : "Tab");
        expect(await page.evaluate(() => Boolean(document.activeElement?.closest('[data-testid="tour-popover"]'))), "focus left the tour").toBe(true);
      }
      expect(await axeBlocking(page), `axe at ${width}px, stop ${n}`).toEqual([]);
      await expectNoOverflow(page);
      const motion = await page.evaluate(() => {
        const ring = document.querySelector('[data-testid="tour-ring"]')!;
        const back = document.querySelector('[data-testid="tour-backdrop"]')!;
        return { anim: getComputedStyle(ring).animationName, dur: getComputedStyle(back).transitionDuration };
      });
      expect(motion.anim).toBe("none");
      // globals.css collapses durations to ~0 under reduced motion; nothing visibly animates.
      expect(Math.max(...motion.dur.split(",").map((d) => Number.parseFloat(d)))).toBeLessThan(0.02);
    }
  }
});
