/**
 * First-run guided demo (src/components/tour): the welcome sheet a brand-new browser sees, and the multi-page tour it
 * starts.
 *  - a fresh context (signed in, nothing remembered) shows the welcome with "Take the 3-minute tour" and "Skip";
 *  - Skip is remembered (localStorage, survives reload and navigation); taking the tour is remembered too;
 *  - the tour walks every stop this build has, in product-story order, across pages, each on its real screen with its
 *    anchor found; progress reads "N of M"; Back/Next/Exit and ←/→/Esc work; focus stays in the popover and returns
 *    on exit; a refresh mid-tour resumes the same stop;
 *  - "Replay tour" in ⌘K starts it again;
 *  - axe (legacy mode) is clean on the open popover; no horizontal overflow at 375/1024/1440; at 375 the popover is
 *    docked to the bottom; the disclaimer stays visible; reduced motion turns the spotlight transition off;
 *  - the tour never sends a mutating API request.
 * Shots: .data/shots/first-run/ (relative to the repo).
 */
import { mkdirSync, readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type BrowserContext, type Page } from "playwright/test";
import { TOUR_STEPS } from "../../src/components/tour/steps";
import { E2E_UI_STATE } from "./env";
import { FIRST_RUN_KEY, withoutFirstRun } from "./first-run";

const DISCLAIMER = "Prototype. Not legal advice. Confirm filings with a qualified professional.";
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const SHOTS = ".data/shots/first-run";
const REQUIRED = TOUR_STEPS.filter((s) => !s.optional).map((s) => s.id);
const ORDER = TOUR_STEPS.map((s) => s.id);
const PATH_OF = new Map(TOUR_STEPS.map((s) => [s.id, s.path]));

test.describe.configure({ mode: "serial", timeout: 600_000 });
test.beforeAll(() => mkdirSync(SHOTS, { recursive: true }));

/** A brand-new browser for the welcome: signed in (the ui server is passcode-gated), nothing else remembered. */
async function freshContext(browser: Browser, baseURL: string | undefined, width = 1440): Promise<BrowserContext> {
  const signedIn = JSON.parse(readFileSync(E2E_UI_STATE, "utf8"));
  return browser.newContext({ baseURL, storageState: withoutFirstRun(signedIn), viewport: { width, height: width < 640 ? 812 : 900 } });
}

const tour = (page: Page) => page.getByTestId("judge-tour");
const welcome = (page: Page) => page.getByTestId("welcome-sheet");
const stored = (page: Page) => page.evaluate((k) => localStorage.getItem(k), FIRST_RUN_KEY);

async function expectNoOverflow(page: Page, label: string) {
  const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  expect(sw, `horizontal overflow at ${iw}px (${label})`).toBeLessThanOrEqual(iw);
}

/** Axe on the tour's own surface (the welcome sheet or the open popover), not the page behind it. */
async function axeBlocking(page: Page, scope: string): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page }).setLegacyMode(true).include(scope).withTags(WCAG_TAGS).analyze();
  return violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
}

/** Waits until stop `n` is on its real screen with its anchor found; returns its id and the tour's length. */
async function onStop(page: Page, n: number): Promise<{ id: string; total: number }> {
  await expect(tour(page)).toHaveAttribute("data-index", String(n), { timeout: 120_000 });
  await expect(tour(page)).toHaveAttribute("data-phase", "ready", { timeout: 120_000 });
  const id = (await tour(page).getAttribute("data-step")) ?? "";
  const total = Number(await tour(page).getAttribute("data-total"));
  expect(new URL(page.url()).pathname, `stop ${n} (${id}) is on its own page`).toBe(PATH_OF.get(id));
  expect(new URL(page.url()).searchParams.get("tour")).toBe(String(n));
  await expect(page.getByTestId("tour-counter")).toContainText(`${n} of ${total}`);
  await expect(page.getByTestId("tour-disclaimer")).toHaveText(DISCLAIMER);
  await expect(page.getByTestId("tour-disclaimer")).toBeInViewport();
  await expect(page.getByTestId("tour-next")).toBeFocused();
  return { id, total };
}

function trackMutations(page: Page): string[] {
  const posts: string[] = [];
  page.on("request", (r) => {
    if (r.method() !== "GET" && r.method() !== "HEAD" && r.url().includes("/api/")) posts.push(new URL(r.url()).pathname);
  });
  return posts;
}

test("a fresh browser sees the welcome; Skip is remembered across reloads and pages", async ({ browser, baseURL }) => {
  const ctx = await freshContext(browser, baseURL);
  const page = await ctx.newPage();
  await page.goto("/dashboard", { timeout: 120_000 });
  await expect(welcome(page)).toBeVisible({ timeout: 60_000 });
  await expect(welcome(page)).toHaveAttribute("role", "dialog");
  await expect(page.getByTestId("welcome-tour")).toHaveText("Take the 3-minute tour");
  await expect(page.getByTestId("welcome-skip")).toHaveText("Skip");
  await expect(page.getByTestId("welcome-tour")).toBeFocused();
  await expect(page.getByTestId("welcome-disclaimer")).toHaveText(DISCLAIMER);
  expect(await stored(page)).toBeNull();
  for (const width of [375, 1024, 1440]) {
    await page.setViewportSize({ width, height: width < 640 ? 812 : 900 });
    await expect(welcome(page)).toBeInViewport();
    await expectNoOverflow(page, "welcome");
    await page.screenshot({ path: `${SHOTS}/welcome-${width}.png` });
  }
  expect(await axeBlocking(page, '[data-testid="welcome-sheet"]'), "axe with the welcome open").toEqual([]);
  // At 375 the sheet is docked to the bottom edge.
  await page.setViewportSize({ width: 375, height: 812 });
  const box = await welcome(page).boundingBox();
  expect(Math.round((box?.y ?? 0) + (box?.height ?? 0))).toBe(812);

  await page.getByTestId("welcome-skip").click();
  await expect(welcome(page)).toHaveCount(0);
  await expect(tour(page)).toHaveCount(0);
  expect(await stored(page)).toBe("skipped");
  await page.reload();
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await expect(page.getByTestId("tour-start")).toBeVisible();
  await expect(welcome(page)).toHaveCount(0);
  await page.goto("/approvals", { timeout: 120_000 });
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await expect(welcome(page)).toHaveCount(0);
  await ctx.close();
});

test("Esc on the welcome is a Skip, and is remembered", async ({ browser, baseURL }) => {
  const ctx = await freshContext(browser, baseURL);
  const page = await ctx.newPage();
  await page.goto("/runs", { timeout: 120_000 });
  await expect(welcome(page)).toBeVisible({ timeout: 60_000 });
  await page.keyboard.press("Escape");
  await expect(welcome(page)).toHaveCount(0);
  expect(await stored(page)).toBe("skipped");
  await ctx.close();
});

test("Take the tour: every stop, in order, across pages, then Finish", async ({ browser, baseURL }) => {
  const ctx = await freshContext(browser, baseURL);
  const page = await ctx.newPage();
  const posts = trackMutations(page);
  await page.goto("/dashboard", { timeout: 120_000 });
  await expect(welcome(page)).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("welcome-tour").click();
  await expect(welcome(page)).toHaveCount(0);
  expect(await stored(page)).toBe("toured");

  const seen: string[] = [];
  let total = Number.POSITIVE_INFINITY;
  for (let n = 1; n <= total; n++) {
    const stop = await onStop(page, n);
    total = stop.total;
    seen.push(stop.id);
    await expectNoOverflow(page, stop.id);
    if (stop.id === "approvals") await expect(page.getByTestId("tour-human")).toContainText("You click Approve");
    if (stop.id === "item") await expect(page.getByTestId("tour-narration")).toContainText("never decides the law");
    await page.waitForTimeout(450); // let the spotlight settle for the screenshot
    await page.screenshot({ path: `${SHOTS}/step-${String(n).padStart(2, "0")}-${stop.id}-1440.png` });
    if (n === 4) {
      // Resumes the same stop after a refresh mid-tour.
      await page.reload();
      await onStop(page, n);
    }
    if (n === total) break;
    if (n % 2) await page.keyboard.press("ArrowRight");
    else await page.getByTestId("tour-next").click();
  }
  // Every required stop is there, in product-story order; optional stops only when their route exists.
  expect(seen.filter((id) => REQUIRED.includes(id))).toEqual(REQUIRED);
  expect([...seen].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b))).toEqual(seen);
  await expect(page.getByTestId("tour-next")).toHaveText("Finish");
  await page.getByTestId("tour-next").click();
  await expect(tour(page)).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get("tour")).toBeNull();
  await page.reload();
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await expect(welcome(page)).toHaveCount(0);
  expect(posts, "the tour must not call any mutating API").toEqual([]);
  await ctx.close();
});

test("Back, ←, Esc and Exit; focus stays in the popover and returns on exit", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/dashboard", { timeout: 120_000 });
  const start = page.getByTestId("tour-start");
  await start.focus();
  await page.keyboard.press("Enter");
  await onStop(page, 1);
  await expect(page.getByTestId("tour-prev")).toBeDisabled();
  await page.keyboard.press("ArrowRight");
  await onStop(page, 2);
  await page.getByTestId("tour-next").click();
  await onStop(page, 3);
  await page.getByTestId("tour-prev").click();
  await onStop(page, 2);
  await page.keyboard.press("ArrowLeft");
  await onStop(page, 1);
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press(i % 4 === 3 ? "Shift+Tab" : "Tab");
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest('[data-testid="tour-popover"]'))), "focus left the tour").toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(tour(page)).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get("tour")).toBeNull();
  await expect(start).toBeFocused();

  await start.click();
  await onStop(page, 1);
  await expect(page.getByTestId("tour-close")).toHaveText("Exit");
  await page.getByTestId("tour-close").click();
  await expect(tour(page)).toHaveCount(0);
  await expect(start).toBeFocused();
});

test("Replay tour from ⌘K starts again at stop 1", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/approvals", { timeout: 120_000 });
  const palette = page.getByTestId("command-palette");
  await expect(async () => {
    await page.keyboard.press("ControlOrMeta+k");
    await expect(palette).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 30_000 });
  await palette.getByRole("combobox").fill("replay");
  await palette.getByRole("option", { name: /Replay tour/ }).click();
  const { id } = await onStop(page, 1);
  expect(id).toBe("exposure");
  expect(new URL(page.url()).pathname).toBe("/dashboard");
});

test("open popover: axe clean, no overflow at 375/1024/1440, docked to the bottom at 375, reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const width of [375, 1024, 1440]) {
    await page.setViewportSize({ width, height: width < 640 ? 812 : 900 });
    for (const n of [1, 5]) {
      await page.goto(`/dashboard?tour=${n}`, { timeout: 120_000 });
      const { id } = await onStop(page, n);
      await expect(tour(page)).toHaveAttribute("data-layout", width < 640 ? "sheet" : "popover");
      const dialog = page.getByRole("dialog", { name: /.+/ }).filter({ has: page.getByTestId("tour-next") });
      await expect(dialog).toHaveAttribute("aria-modal", "true");
      expect(await axeBlocking(page, '[data-testid="tour-popover"]'), `axe at ${width}px, stop ${n} (${id})`).toEqual([]);
      await expectNoOverflow(page, `${id} at ${width}`);
      if (width < 640) {
        const box = await page.getByTestId("tour-popover").boundingBox();
        expect(Math.round((box?.y ?? 0) + (box?.height ?? 0))).toBe(812);
      }
      const dur = await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="tour-backdrop"]')!).transitionDuration);
      expect(Math.max(...dur.split(",").map((d) => Number.parseFloat(d)))).toBeLessThan(0.02);
      await page.screenshot({ path: `${SHOTS}/popover-${width}-${String(n).padStart(2, "0")}-${id}.png` });
    }
  }
});
