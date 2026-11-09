/**
 * ASK-MODE slice 1 (docs/ASK-MODE.md §5): the Ask / Dashboard mode switch and the Ask landing, with today's chat tools.
 *  - login lands on /ask with the headline and starter chips from real state
 *  - the segmented switch goes both ways; mod+/ toggles and returns to the last Dashboard page
 *  - /chat?q= redirects to /ask with its query (sends when chat can answer, prefills when it cannot)
 *  - Ask has no Loop Bar and no section pill nav; the ☰ sheet lists every page; the approvals count stays visible
 *  - the "Where the money is" preview renders its flat fallback under reduced motion
 *  - axe, no horizontal overflow at 375 / 1024 / 1440, the disclaimer on every screen
 *
 *   E2E_PORT=3993 E2E_DIR_SUFFIX=ask1 CI=1 pnpm exec playwright test tests/e2e/ui-ask-mode.spec.ts --project ui
 * With ESCHEAT_OFFLINE=1 the redirect test also checks the question is sent and replayed, and writes the conversation shot.
 * Screenshots go to .data/shots/ask1/.
 */
import { mkdirSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "playwright/test";
import { E2E_UI_PASSCODE } from "./env";
import { firstRunSeen } from "./first-run";
import { offlineAnswerable } from "../../src/lib/ask/starters";

const DISCLAIMER = "Prototype. Not legal advice. Confirm filings with a qualified professional.";
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const SHOTS = ".data/shots/ask1";
const WIDTHS = [375, 1024, 1440] as const;
const MOD = process.platform === "darwin" ? "Meta" : "Control";

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

/** A mode-switch segment in the top bar (a streamed-in copy can sit hidden at the end of <body> for a moment). */
const seg = (page: Page, mode: "ask" | "dashboard") => page.getByTestId("top-bar").getByTestId(`mode-${mode}`);

async function openAsk(page: Page, path = "/ask") {
  await page.goto(path, { timeout: 90_000 });
  await expect(page.getByTestId("ask-headline")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("chat-input")).toBeVisible();
  await expect(seg(page, "ask")).toHaveAttribute("aria-current", "page");
  await hydrated(page);
}

/** The top bar's visible pieces (brand + switch, pill nav, each tool) never overlap one another. */
async function topBarOverlaps(page: Page): Promise<string[]> {
  return page.getByTestId("top-bar").evaluate((bar) => {
    const items = [...bar.querySelectorAll<HTMLElement>("a, button, nav[aria-label='Sections']")]
      .filter((el) => !el.closest("nav[aria-label='Sections']") || el.matches("nav[aria-label='Sections']"))
      .filter((el) => !el.closest("nav[aria-label='Mode']") || el.matches("a"))
      .map((el) => ({ name: el.getAttribute("aria-label") ?? el.textContent?.trim() ?? el.tagName, r: el.getBoundingClientRect() }))
      .filter((x) => x.r.width > 0 && x.r.height > 0);
    const out: string[] = [];
    for (let i = 0; i < items.length; i++)
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i]!.r;
        const b = items[j]!.r;
        if (a.left < b.right - 1 && b.left < a.right - 1) out.push(`${items[i]!.name} × ${items[j]!.name}`);
      }
    return out;
  });
}

/** The shell has hydrated: the mode switch has read the session (and the global key handler is attached). */
async function hydrated(page: Page) {
  await expect(page.getByTestId("top-bar").getByTestId("mode-switch")).toHaveAttribute("data-ready", "true", { timeout: 60_000 });
}

async function isOffline(page: Page): Promise<boolean> {
  return ((await page.getByTestId("chat-model").textContent()) ?? "").includes("offline");
}

test.beforeAll(() => mkdirSync(SHOTS, { recursive: true }));
test.describe.configure({ timeout: 150_000 });

test("login lands on /ask with the headline, the composer and starter chips from real state", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [firstRunSeen(baseURL!)] } });
  const page = await context.newPage();
  await page.goto("/login", { waitUntil: "load", timeout: 90_000 });
  await expect(page.getByLabel("Passcode")).toBeEditable();
  for (let i = 0; i < 5 && new URL(page.url()).pathname.startsWith("/login"); i++) {
    await page.getByLabel("Passcode").fill(E2E_UI_PASSCODE);
    await page.getByRole("button", { name: "Enter" }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20_000 }).catch(() => undefined);
  }
  await expect(page).toHaveURL(/\/ask$/);
  await expect(page.getByRole("heading", { level: 1, name: /What do you want\s*to get done\?/ })).toBeVisible();
  await expect(page.getByText("Ask a question, or ask me to do something. Anything that leaves the app waits for your click.")).toBeVisible();
  const chips = page.getByTestId("chat-example");
  expect(await chips.count()).toBeGreaterThanOrEqual(2);
  expect(await chips.count()).toBeLessThanOrEqual(6);
  // With a key the always-on reads are there; keyless (R11-05) the landing leads with the working cards instead.
  if ((await page.getByTestId("chat-model").textContent())?.includes("not configured")) await expect(chips.first()).toContainText("Get started");
  else await expect(chips.filter({ hasText: "What do we owe and where?" })).toBeVisible();
  for (const tone of await chips.evaluateAll((els) => els.map((e) => e.getAttribute("data-tone")))) expect(["human", "info"]).toContain(tone);
  if (await isOffline(page)) {
    for (const t of await chips.allInnerTexts()) {
      const prompt = t.split("·")[0]!.trim();
      expect(offlineAnswerable(prompt), prompt).toBe(true);
    }
  }
  await expect(page.getByText(DISCLAIMER).first()).toBeVisible();
  await context.close();
});

test("Ask chrome: mode switch after the brand, approvals count on Dashboard, no Loop Bar or section nav; the ☰ sheet lists every page", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openAsk(page);
  const sw = page.getByRole("navigation", { name: "Mode" });
  await expect(sw).toBeVisible();
  await expect(sw.getByRole("link", { name: "Ask" })).toHaveAttribute("aria-current", "page");
  await expect(sw.getByRole("link", { name: /Dashboard/ })).toHaveAttribute("aria-keyshortcuts", "Meta+/ Control+/");
  await expect(page.getByTestId("pill-nav")).toHaveCount(0);
  await expect(page.getByTestId("loop-bar")).toHaveCount(0);

  // The approvals count matches the API's queue (the same count as the Approvals page) and is visible from Ask.
  const waiting = await page.getByTestId("top-bar").getByTestId("mode-waiting").count();
  if (waiting) await expect(page.getByTestId("top-bar").getByTestId("mode-waiting")).toHaveText(/^\d+ waiting for approval$/);

  await page.getByRole("button", { name: /Open navigation/ }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  for (const label of ["Ask", "Dashboard", "Items", "Approvals", "Ledger", "Rules", "Reports", "Agent runs", "Settings"]) {
    await expect(sheet.getByRole("link", { name: label, exact: true }).or(sheet.getByRole("link", { name: new RegExp(`^${label}\\b`) })).first()).toBeVisible();
  }
  await page.keyboard.press("Escape");

  // Dashboard mode keeps the V4 shell.
  await seg(page, "dashboard").click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 60_000 });
  await expect(seg(page, "dashboard")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("pill-nav")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/dashboard-1440.png` });
  await seg(page, "ask").click();
  await expect(page).toHaveURL(/\/ask$/, { timeout: 60_000 });
  await expect(page.getByTestId("ask-headline")).toBeVisible();
});

test("mod+/ toggles mode and returns to the last Dashboard page, also from the composer", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/items", { timeout: 90_000 });
  await expect(seg(page, "dashboard")).toHaveAttribute("aria-current", "page", { timeout: 30_000 });
  await hydrated(page);
  await page.keyboard.press(`${MOD}+/`);
  await expect(page).toHaveURL(/\/ask$/, { timeout: 60_000 });
  await expect(page.getByTestId("ask-headline")).toBeVisible();
  // The Dashboard segment now points back where you were.
  await expect(seg(page, "dashboard")).toHaveAttribute("href", "/items");
  await page.getByTestId("chat-input").focus();
  await page.keyboard.press(`${MOD}+/`);
  await expect(page).toHaveURL(/\/items$/, { timeout: 60_000 });
});

test("/chat?q= redirects to /ask with the question (sent when chat can answer, prefilled when it cannot)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const q = "What do we owe and where?";
  await page.goto(`/chat?q=${encodeURIComponent(q)}`, { timeout: 90_000 });
  await expect(page).toHaveURL(/\/ask$/, { timeout: 30_000 });
  await expect(page.getByTestId("chat-model")).toBeVisible();
  if (await isOffline(page)) {
    await expect(page.getByTestId("chat-user-message").first()).toHaveText(q, { timeout: 30_000 });
    const last = page.getByTestId("chat-assistant-message").last();
    await expect(last).toHaveAttribute("data-status", "done", { timeout: 60_000 });
    await expect(page.getByTestId("view-exposure").last()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("chat-empty")).toHaveCount(0);
    await page.waitForTimeout(800); // card entrance settles before the screenshot (motion only, no assertion depends on it)
    await page.screenshot({ path: `${SHOTS}/ask-conversation-1440.png` });
  } else {
    await expect(page.getByTestId("chat-not-configured")).toBeVisible();
    await expect(page.getByTestId("chat-input")).toHaveValue(q);
    await expect(page.getByTestId("chat-user-message")).toHaveCount(0);
  }
  // Deep links: /chat without a query lands on /ask, and existing pages keep their URL.
  await page.goto("/chat", { timeout: 90_000 });
  await expect(page).toHaveURL(/\/ask$/);
  await page.goto("/reports?state=CA", { timeout: 90_000 });
  await expect(page).toHaveURL(/\/reports\?state=CA$/);
  await expect(seg(page, "dashboard")).toHaveAttribute("aria-current", "page");
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });
  test("the money-map preview renders its flat static fallback with the same total, and keeps its screen-reader table", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openAsk(page);
    const preview = page.getByTestId("ask-map-preview");
    await expect(preview).toBeVisible();
    await expect(preview.locator("[data-map-root]")).toHaveAttribute("data-tier", "static");
    await expect(preview.getByTestId("ask-map-total")).toContainText(/\$[\d,]+\.\d{2} across \d+ states?/);
    await expect(preview.locator("table")).toHaveCount(1);
    await expect(preview.locator("canvas")).toHaveCount(0);
  });
});

for (const width of WIDTHS) {
  test(`Ask at ${width}px: axe clean, no horizontal overflow, disclaimer and composer visible`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
    await openAsk(page);
    await expect(page.getByTestId("top-bar").getByTestId("mode-switch")).toBeVisible();
    await expect(page.getByTestId("ask-starters")).toBeVisible();
    expect(await overflowPx(page)).toBeLessThanOrEqual(0);
    expect(await topBarOverlaps(page), `Ask top bar at ${width}`).toEqual([]);
    await expect(page.getByText(DISCLAIMER).first()).toBeVisible();
    expect(await axeBlocking(page)).toEqual([]);
    // The preview's state labels fade in after their columns rise (first visit only); shoot the settled map.
    const labels = page.getByTestId("ask-map-preview").locator("[data-map-col]");
    await expect(labels.first()).toBeVisible();
    await expect.poll(() => labels.evaluateAll((els) => els.every((e) => Number(getComputedStyle(e).opacity) === 1)), { timeout: 10_000 }).toBe(true);
    // Every column label is a link a person can click to ask about that state.
    for (const href of await labels.evaluateAll((els) => els.map((e) => e.getAttribute("href")))) expect(href).toMatch(/^\/items\?state=[A-Z]{2}$/);
    if (width !== 1024) await page.screenshot({ path: `${SHOTS}/ask-${width}.png`, fullPage: width === 375 });

    await page.goto("/dashboard", { timeout: 90_000 });
    await expect(seg(page, "dashboard")).toHaveAttribute("aria-current", "page", { timeout: 30_000 });
    expect(await overflowPx(page)).toBeLessThanOrEqual(0);
    expect(await topBarOverlaps(page), `Dashboard top bar at ${width}`).toEqual([]);
  });
}

test("the top bar never overlaps between the tested widths either (640, 768, 1280)", async ({ page }) => {
  for (const width of [640, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ["/ask", "/dashboard"]) {
      await page.goto(path, { timeout: 90_000 });
      await hydrated(page);
      await page.evaluate(() => document.fonts.ready);
      expect(await topBarOverlaps(page), `${path} at ${width}`).toEqual([]);
      expect(await overflowPx(page)).toBeLessThanOrEqual(0);
    }
  }
});
