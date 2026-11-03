/**
 * DESIGN-V3 slice 1 (foundation): the shell on /dashboard, /items and /approvals; the Loop Bar's live counts; the ⌘K
 * palette and its Do section; the `.` next-best-action key; the shortcut registry (? sheet, g chords); reduced motion
 * (OS setting and the in-app preference) rendering final states; axe; no horizontal overflow at 375/1024/1440.
 * Also writes .data/shots/v3-foundation-*.png. Read-only: no approvals, drafts or sends.
 */
import { mkdirSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "playwright/test";

const DISCLAIMER = "Prototype. Not legal advice. Confirm filings with a qualified professional.";
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const MOD = process.platform === "darwin" ? "Meta" : "Control";
const SHOTS = ".data/shots";

const SURFACES = [
  { name: "dashboard", path: "/dashboard", ready: (p: Page) => p.getByRole("region", { name: "Total exposure" }) },
  { name: "items", path: "/items", ready: (p: Page) => p.locator("tbody tr[data-row-id]").first() },
  { name: "approvals", path: "/approvals", ready: (p: Page) => p.locator("[data-key]").first() },
] as const;

async function open(page: Page, s: (typeof SURFACES)[number]) {
  await page.goto(s.path);
  await expect(s.ready(page)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("loop-bar")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(DISCLAIMER)).toBeVisible();
}

async function loopCounts(page: Page): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const id of ["triage", "draft", "approve", "file"]) out[id] = (await page.getByTestId(`loop-count-${id}`).textContent())?.trim() ?? "";
  return out;
}

async function axeBlocking(page: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page }).setLegacyMode(true).withTags(WCAG_TAGS).analyze();
  return violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
}

/** Wait until the client shell has hydrated (the global key handler is attached in an effect). */
async function hydrated(page: Page) {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await expect(page.getByTestId("next-action")).toBeVisible();
}

test.beforeAll(() => mkdirSync(SHOTS, { recursive: true }));

test.describe("shell", () => {
  for (const s of SURFACES) {
    test(`${s.name}: sidebar, top bar, Loop Bar, next action and footer render`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await open(page, s);
      await expect(page.getByRole("navigation", { name: "Main navigation" }).first()).toBeVisible();
      await expect(page.getByRole("button", { name: /Search or run a command/ })).toBeVisible();
      await expect(page.getByTestId("synthetic-chip")).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Core loop" })).toBeVisible();
      for (const id of ["triage", "draft", "approve", "file"]) await expect(page.getByTestId(`loop-stage-${id}`)).toBeVisible();
      await expect(page.getByTestId("next-action")).toBeVisible();
      await page.screenshot({ path: `${SHOTS}/v3-foundation-${s.name}-1440.png`, fullPage: false });
      await page.setViewportSize({ width: 375, height: 812 });
      await expect(page.getByTestId("loop-bar")).toBeVisible();
      await page.screenshot({ path: `${SHOTS}/v3-foundation-${s.name}-375.png`, fullPage: false });
    });
  }

  test("sidebar collapses with [ and expands again", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, SURFACES[0]);
    await hydrated(page);
    const frame = page.locator("[data-collapsed]");
    await expect(frame).toHaveAttribute("data-collapsed", "false");
    await page.keyboard.press("[");
    await expect(frame).toHaveAttribute("data-collapsed", "true");
    await expect(page.getByRole("navigation", { name: "Main navigation" }).first().getByRole("link", { name: "Items", exact: true })).toBeVisible();
    await page.keyboard.press("[");
    await expect(frame).toHaveAttribute("data-collapsed", "false");
  });
});

test.describe("Loop Bar", () => {
  test("shows real counts: integers, Approve equals the nav badge and the next action follows the priority", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, SURFACES[2]);
    const counts = await loopCounts(page);
    for (const [k, v] of Object.entries(counts)) expect(v, `${k} count is a number`).toMatch(/^\d+$/);

    // Approve uses the single queue-count query behind the pink nav badge.
    const badge = page.getByRole("navigation", { name: "Main navigation" }).first().getByRole("link", { name: /Approvals/ });
    const badgeText = (await badge.textContent()) ?? "";
    const badgeCount = Number(/(\d+)/.exec(badgeText)?.[1] ?? "0");
    expect(Number(counts.approve)).toBe(badgeCount);

    // Priority: any waiting approval means the next action is an approval.
    const kind = await page.getByTestId("next-action").getAttribute("data-kind");
    if (Number(counts.approve) > 0) expect(kind).toMatch(/^approve/);
    else if (Number(counts.draft) > 0) expect(kind).toBe("draft");
    else if (Number(counts.file) > 0) expect(kind).toBe("file");

    // Every stage links to its preset view, and the current page's stage is marked.
    await expect(page.getByTestId("loop-stage-approve")).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("loop-stage-triage")).toHaveAttribute("href", "/items?view=needs-action");
    await expect(page.getByTestId("loop-stage-file")).toHaveAttribute("href", "/reports?filter=approved");
  });
});

test.describe("keyboard", () => {
  test("⌘K opens the palette with a Do section, and a Do action runs (Toggle reduce motion)", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, SURFACES[0]);
    await hydrated(page);
    const palette = page.getByTestId("command-palette");
    await expect(async () => {
      await page.keyboard.press(`${MOD}+k`);
      await expect(palette).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
    await expect(palette.getByText("Do", { exact: true })).toBeVisible();
    await expect(palette.getByTestId("palette-next-action")).toBeVisible();
    await expect(palette.getByRole("option", { name: /Approve next/ })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/v3-foundation-palette-1440.png` });
    expect(await axeBlocking(page)).toEqual([]);

    await page.keyboard.type("reduce motion");
    await expect(palette.getByRole("option").first()).toContainText("Toggle reduce motion");
    await page.keyboard.press("Enter");
    await expect(palette).toBeHidden();
    await expect(page.locator("html")).toHaveAttribute("data-motion", "reduce");
    expect(await page.evaluate(() => localStorage.getItem("es-motion"))).toBe("reduce");

    // And back off again through the same command.
    await page.keyboard.press(`${MOD}+k`);
    await expect(palette).toBeVisible();
    await page.keyboard.type("reduce motion");
    await page.keyboard.press("Enter");
    await expect(page.locator("html")).not.toHaveAttribute("data-motion", "reduce");
  });

  test("palette at 375px", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await open(page, SURFACES[0]);
    await hydrated(page);
    await expect(async () => {
      await page.keyboard.press(`${MOD}+k`);
      await expect(page.getByTestId("command-palette")).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
    await page.screenshot({ path: `${SHOTS}/v3-foundation-palette-375.png` });
  });

  test("`.` runs the next best action", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, SURFACES[0]);
    await hydrated(page);
    const href = (await page.getByTestId("next-action").getAttribute("href"))!;
    expect(href).toMatch(/^\//);
    await page.locator("body").click({ position: { x: 1, y: 1 } });
    await page.keyboard.press(".");
    const [pathname] = href.split("?");
    await expect(page).toHaveURL(new RegExp(`${pathname!.replace(/\//g, "\\/")}`), { timeout: 30_000 });
  });

  test("? opens the shortcuts sheet from the registry; g i goes to Items", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, SURFACES[0]);
    await hydrated(page);
    await page.locator("body").click({ position: { x: 1, y: 1 } });
    await page.keyboard.press("Shift+?");
    const sheet = page.getByTestId("shortcuts-sheet");
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText("Run the next best action");
    await expect(sheet).toContainText("Approve and advance to the next");
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await page.keyboard.press("g");
    await page.keyboard.press("i");
    await expect(page).toHaveURL(/\/items/, { timeout: 30_000 });
  });
});

test.describe("reduced motion renders final states", () => {
  test.use({ reducedMotion: "reduce" });

  for (const s of SURFACES) {
    test(`${s.name}: OS reduced motion, no running animations`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await open(page, s);
      await page.waitForLoadState("networkidle").catch(() => undefined);
      const running = await page.evaluate(
        () => document.getAnimations().filter((a) => a.playState === "running" && Number(a.effect?.getTiming().duration) > 1).length,
      );
      expect(running).toBe(0);
    });
  }
});

test("in-app Reduce motion preference applies before first paint", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("es-motion", "reduce"));
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, SURFACES[0]);
  await expect(page.locator("html")).toHaveAttribute("data-motion", "reduce");
  const running = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running" && Number(a.effect?.getTiming().duration) > 1).length);
  expect(running).toBe(0);
});

test.describe("layout and accessibility", () => {
  test.use({ reducedMotion: "reduce" });

  for (const s of SURFACES) {
    for (const width of [375, 1024, 1440] as const) {
      test(`${s.name} @${width}px: no horizontal overflow, axe clean`, async ({ page }) => {
        await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
        await open(page, s);
        await page.evaluate(() => document.fonts.ready);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
        expect(await axeBlocking(page)).toEqual([]);
      });
    }
  }
});
