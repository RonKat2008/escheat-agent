/**
 * ASK-MODE slice 5 (docs/ASK-MODE.md §5): a calm, view-only Dashboard overview and Ask polish.
 *  - the overview's first viewport is the stage; below it at most three sections until "More detail" opens, and the
 *    fold (closed by default) holds the loop strip, recent activity, the money flow, status, audit interest, one check
 *  - "Do it in Ask" links exist only for prompts Ask answers today, and land in Ask with the prompt sent (offline run)
 *  - the 3D Money Map has its static fallback under reduced motion
 *  - the Ask vault ornament: poster only (no <canvas>) under reduced motion, none below 1024px, canvas after idle at
 *    the full tier when the browser has WebGL
 *  - every Dashboard page has a one-sentence purpose line under its title
 *  - axe, no horizontal overflow at 375 / 1024 / 1440 on the dashboard, /ask and four other pages; the disclaimer
 *
 *   E2E_PORT=3997 E2E_DIR_SUFFIX=ask5 CI=1 pnpm exec playwright test tests/e2e/ui-ask-calm.spec.ts --project ui
 * With ESCHEAT_OFFLINE=1 the "Do it in Ask" test also follows a link and checks the question is sent.
 * Screenshots go to .data/shots/ask5/.
 */
import { mkdirSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "playwright/test";
import { offlineAnswerable } from "../../src/lib/ask/starters";
import { finishAnimations, waitForFlowLayout } from "./animations";
import { openDashboardDetail } from "./dashboard-detail";

const DISCLAIMER = "Prototype. Not legal advice. Confirm filings with a qualified professional.";
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const SHOTS = ".data/shots/ask5";
const WIDTHS = [375, 1024, 1440] as const;
const PAGES = ["/items", "/approvals", "/ledger", "/rules"] as const;

async function axeBlocking(page: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page }).setLegacyMode(true).withTags(WCAG_TAGS).analyze();
  return violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
}

async function overflowPx(page: Page): Promise<number> {
  await page.evaluate(() => document.fonts.ready);
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

async function openDashboard(page: Page) {
  await page.goto("/dashboard", { timeout: 90_000 });
  await expect(page.getByTestId("dash-stage")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("dash-more")).toBeAttached({ timeout: 60_000 });
}

async function openAsk(page: Page) {
  await page.goto("/ask", { timeout: 90_000 });
  await expect(page.getByTestId("ask-headline")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("top-bar").getByTestId("mode-switch")).toHaveAttribute("data-ready", "true", { timeout: 60_000 });
}

/** Pins the hardware signals the render tier reads (CI runners report 4 cores), as ui-v3-landing does. */
async function pinCapableHardware(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, "hardwareConcurrency", { get: () => 8, configurable: true });
    Object.defineProperty(Navigator.prototype, "deviceMemory", { get: () => 8, configurable: true });
  });
}

test.beforeAll(() => mkdirSync(SHOTS, { recursive: true }));
test.describe.configure({ timeout: 180_000 });

test("the overview is calm: the stage first, at most three sections, everything else behind a closed More detail", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openDashboard(page);
  const stage = await page.getByTestId("dash-stage").boundingBox();
  expect(stage!.y, "stage right under the top bar").toBeLessThan(110);

  const more = page.getByTestId("dash-more");
  await expect(more).not.toHaveAttribute("open", /.*/);
  const open = page.locator("[data-dash-section]").filter({ has: page.locator("h2") });
  const visible = await open.evaluateAll((els) => els.filter((el) => !el.closest("[data-testid=dash-more]") && (el as HTMLElement).offsetParent !== null).map((el) => el.getAttribute("data-dash-section")));
  expect(visible.length, `sections before More detail: ${visible.join(", ")}`).toBeLessThanOrEqual(3);
  expect(visible).toEqual(["where-h", "due-h"]);
  // The 3D money map and the deadlines stay on the overview.
  await expect(page.locator('[data-tour="states"] [data-map-root]')).toBeVisible();
  await expect(page.getByTestId("deadline-strip")).toBeVisible();
  await expect(page.getByTestId("hero-deadlines")).toBeVisible();
  await expect(page.getByTestId("cfo-brief-download")).toBeVisible();
  // Denser panels are folded away.
  for (const id of ["loop-slot", "recent-activity", "money-flow"]) await expect(page.getByTestId(id)).toBeHidden();
  await finishAnimations(page);
  await page.screenshot({ path: `${SHOTS}/dashboard-1440.png` });

  await openDashboardDetail(page);
  for (const id of ["loop-slot", "recent-activity", "money-flow"]) await expect(page.getByTestId(id)).toBeVisible();
  await expect(page.getByRole("region", { name: "Featured item" })).toBeVisible();
  await waitForFlowLayout(page);
  await finishAnimations(page);
  await page.screenshot({ path: `${SHOTS}/dashboard-1440-full.png`, fullPage: true });
  await more.locator("summary").click();
  await expect(more).not.toHaveAttribute("open", /.*/);
  await expect(page.getByTestId("money-flow")).toBeHidden();
});

test("Do it in Ask links only carry prompts Ask answers today, and land in Ask with the prompt sent", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openDashboard(page);
  const links = page.getByTestId("do-in-ask");
  const prompts = await links.evaluateAll((els) => els.map((e) => e.getAttribute("data-prompt") ?? ""));
  for (const p of prompts) expect(offlineAnswerable(p), p).toBe(true);
  for (const href of await links.evaluateAll((els) => els.map((e) => e.getAttribute("href") ?? ""))) expect(href).toMatch(/^\/ask\?q=/);
  // The hero's CTA is coral only when a person must act, and never an Ask prompt Ask cannot answer.
  const cta = page.getByTestId("hero-cta");
  const ctaHref = (await cta.getAttribute("href")) ?? "";
  if (ctaHref.startsWith("/ask")) expect(offlineAnswerable(new URL(ctaHref, "http://x").searchParams.get("q") ?? "")).toBe(true);

  // Ask can answer only with a key or in offline replay; with neither the composer is disabled, so there are no links.
  await page.goto("/ask", { timeout: 90_000 });
  const model = (await page.getByTestId("chat-model").textContent({ timeout: 60_000 })) ?? "";
  if (model.includes("not configured")) {
    await openDashboard(page);
    await expect(page.getByTestId("do-in-ask")).toHaveCount(0);
    return;
  }
  await openDashboard(page);
  expect(await links.count()).toBeGreaterThan(0);
  const prompt = (await links.first().getAttribute("data-prompt"))!;
  await links.first().click();
  await expect(page).toHaveURL(/\/ask(\?|$)/, { timeout: 60_000 });
  await expect(page.getByTestId("chat-user-message").first()).toContainText(prompt, { timeout: 60_000 });
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("the dashboard's 3D Money Map renders its static fallback", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openDashboard(page);
    const map = page.locator('[data-tour="states"] [data-map-root]');
    await expect(map).toHaveAttribute("data-tier", "static");
    await expect(page.locator('[data-tour="states"] canvas')).toHaveCount(0);
  });

  test("the Ask vault ornament is the poster only, with no canvas", async ({ page }) => {
    await pinCapableHardware(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openAsk(page);
    const orn = page.getByTestId("ask-ornament");
    await expect(orn).toHaveAttribute("aria-hidden", "true");
    await expect(orn.locator('img[src*="vault-poster"]')).toBeAttached();
    await expect(orn.locator("[data-tier]")).toHaveAttribute("data-tier", "static");
    await page.waitForTimeout(4_000); // past the 2s idle timeout
    await expect(orn.locator("canvas")).toHaveCount(0);
  });
});

test("the Ask vault ornament: none below 1024px; at the full tier the canvas mounts after idle (poster without WebGL)", async ({ page }) => {
  await pinCapableHardware(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await openAsk(page);
  await expect(page.getByTestId("ask-ornament")).toHaveCount(0);

  await page.setViewportSize({ width: 1440, height: 900 });
  const orn = page.getByTestId("ask-ornament");
  await expect(orn.locator('img[src*="vault-poster"]')).toBeAttached({ timeout: 10_000 });
  const gl = await page.evaluate(() => !!document.createElement("canvas").getContext("webgl2") || !!document.createElement("canvas").getContext("webgl"));
  test.info().annotations.push({ type: "webgl", description: String(gl) });
  if (gl) {
    // The scene mounts after idle; a slow software renderer may then drop it back to the poster (the FPS probe).
    await expect
      .poll(async () => (await orn.locator("canvas").count()) > 0 || (await orn.locator("[data-tier]").getAttribute("data-tier")) === "static", { timeout: 60_000 })
      .toBe(true);
  } else {
    await page.waitForTimeout(4_000);
    await expect(orn.locator("canvas")).toHaveCount(0);
  }
  await expect(page.getByTestId("ask-headline")).toBeVisible();
  expect(await axeBlocking(page)).toEqual([]);
  await page.screenshot({ path: `${SHOTS}/ask-1440.png` });

  // Sending the first message collapses the hero, which unmounts the ornament.
  // (With chat not configured the composer is disabled and the hero stays.)
  if (await page.getByTestId("chat-input").isEnabled()) {
    await page.getByTestId("chat-input").fill("What do we owe and where?");
    await page.getByTestId("chat-input").press("Enter");
    await expect(page.getByTestId("chat-user-message").first()).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("ask-ornament")).toHaveCount(0);
  }
});

test("every Dashboard page has a one-sentence purpose line under its title", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const paths = ["/items", "/approvals", "/ledger", "/rules", "/reports", "/forecast", "/horizon", "/recoveries", "/payees", "/activity", "/audit", "/runs", "/eval"];
  for (const path of paths) {
    await page.goto(path, { timeout: 90_000 });
    const h1 = page.locator("main h1#page-heading");
    await expect(h1, path).toBeVisible({ timeout: 60_000 });
    const line = (await h1.evaluate((el) => el.nextElementSibling?.textContent ?? "")).trim();
    expect(line.length, `${path} purpose line`).toBeGreaterThan(20);
    expect(line.split(/(?<=[.!?])\s+(?=[A-Z])/).length, `${path} is one sentence: ${line}`).toBe(1);
  }
});

test("rarely used panels are folded: Rules research notes and version history, Eval run details", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/rules?state=TX", { timeout: 90_000 });
  const notes = page.getByTestId("rules-notes");
  await expect(notes).toBeAttached({ timeout: 60_000 });
  await expect(notes).not.toHaveAttribute("open", /.*/);
  await notes.locator("summary").click();
  await expect(notes.locator("li").first()).toBeVisible();
  // Version history is folded while only the shipped version exists, and opens once a person has approved values.
  const hist = page.getByTestId("rules-history");
  if ((await hist.getAttribute("open")) === null) await hist.locator("summary").click();
  await expect(hist.locator("table").first()).toBeVisible();
  await page.goto("/eval", { timeout: 90_000 });
  const run = page.getByTestId("eval-run-details");
  await expect(run).toBeAttached({ timeout: 60_000 });
  await expect(run).not.toHaveAttribute("open", /.*/);
});

for (const width of WIDTHS) {
  test(`at ${width}px: axe clean, no horizontal overflow, the disclaimer on the dashboard, /ask and four pages`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
    await openDashboard(page);
    expect(await overflowPx(page), `dashboard at ${width}`).toBeLessThanOrEqual(0);
    await expect(page.getByText(DISCLAIMER).first()).toBeVisible();
    expect(await axeBlocking(page), `dashboard at ${width}`).toEqual([]);
    if (width === 375) await page.screenshot({ path: `${SHOTS}/dashboard-375.png`, fullPage: true });
    await openDashboardDetail(page);
    expect(await overflowPx(page), `dashboard (More detail open) at ${width}`).toBeLessThanOrEqual(0);

    await openAsk(page);
    expect(await overflowPx(page), `/ask at ${width}`).toBeLessThanOrEqual(0);
    await expect(page.getByText(DISCLAIMER).first()).toBeVisible();
    expect(await axeBlocking(page), `/ask at ${width}`).toEqual([]);

    for (const path of PAGES) {
      await page.goto(path, { timeout: 90_000 });
      await expect(page.locator("main h1").first()).toBeVisible({ timeout: 60_000 });
      await page.waitForLoadState("networkidle").catch(() => undefined);
      expect(await overflowPx(page), `${path} at ${width}`).toBeLessThanOrEqual(0);
      await expect(page.getByText(DISCLAIMER).first()).toBeVisible();
      expect(await axeBlocking(page), `${path} at ${width}`).toEqual([]);
      if (width === 1440 && path !== "/rules") await page.screenshot({ path: `${SHOTS}${path}-1440.png` });
    }
  });
}
