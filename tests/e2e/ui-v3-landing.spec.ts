/**
 * DESIGN-V3 slice 9 (landing + marketing, The Vault): the poster paints first and the OGL canvas mounts after idle at
 * the full tier; reduced motion keeps the poster only; the CTA reaches the app; axe; no horizontal overflow at
 * 375/1024/1440; no console errors. Writes .data/shots/v3-landing-*.png. Read-only.
 */
import { mkdirSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type ConsoleMessage, type Page } from "playwright/test";

const DISCLAIMER = "Prototype. Not legal advice. Confirm filings with a qualified professional.";
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const SHOTS = ".data/shots";
const ROUTES = ["/", "/how-it-works", "/security"] as const;
// The scene chunk compiles on demand under `next dev`, so the first mount can take a while.
const SCENE_TIMEOUT = 120_000;

// WebGL in headless Chromium runs on SwiftShader.
test.use({ launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] } });

test.beforeAll(() => mkdirSync(SHOTS, { recursive: true }));

async function axeBlocking(page: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page }).setLegacyMode(true).withTags(WCAG_TAGS).analyze();
  return violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
}

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (m: ConsoleMessage) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  return errors;
}

test.describe("The Vault", () => {
  test("the hero shows the poster immediately, then the canvas mounts after idle at the full tier", async ({ page }) => {
    test.setTimeout(SCENE_TIMEOUT + 60_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const hero = page.getByTestId("hero-vault");
    const poster = hero.locator('img[src*="vault-poster"]');
    await expect(poster).toBeVisible();
    // Labels are DOM over the poster, present before any WebGL.
    await expect(hero.locator('[data-label="CA"]')).toBeAttached();
    await expect(hero.locator('[data-label="gate"]')).toContainText("Needs your approval");
    const scene = hero.getByTestId("vault-canvas");
    await expect(scene.locator("canvas")).toBeAttached({ timeout: SCENE_TIMEOUT });
    await expect(scene).toHaveAttribute("data-mounted-tier", "full");
    await expect(scene).toHaveAttribute("data-running", "true");
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${SHOTS}/v3-landing-1440.png` });
  });

  test("reduced motion keeps the poster only", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    const hero = page.getByTestId("hero-vault");
    await expect(hero.locator('img[src*="vault-poster"]')).toBeVisible();
    await expect(hero.locator("[data-tier]")).toHaveAttribute("data-tier", "static");
    await page.waitForTimeout(4000); // past the 2s idle timeout
    await expect(hero.locator("canvas")).toHaveCount(0);
    // Steps and headings are complete and readable without motion.
    await expect(page.locator(".vx-step")).toHaveCount(4);
    for (const h of await page.locator("main h2").all()) await expect(h).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/v3-landing-reduced-motion.png` });
  });

  test("the primary CTA opens the demo", async ({ page }) => {
    await page.goto("/");
    const cta = page.locator("main").getByRole("link", { name: "Open the demo" }).first();
    await expect(cta).toHaveAttribute("href", "/dashboard");
    await cta.click();
    await expect(page).toHaveURL(/\/(dashboard|login)/, { timeout: 60_000 });
  });
});

test.describe("marketing pages", () => {
  for (const route of ROUTES) {
    test(`${route}: one h1, the disclaimer, axe clean, no console errors`, async ({ page }) => {
      const errors = collectErrors(page);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(route);
      await expect(page.locator("h1")).toHaveCount(1);
      await expect(page.getByText(DISCLAIMER)).toBeVisible();
      await page.waitForLoadState("networkidle").catch(() => undefined);
      expect(await axeBlocking(page)).toEqual([]);
      expect(errors).toEqual([]);
    });

    test(`${route}: no horizontal overflow at 375, 1024 and 1440`, async ({ page }) => {
      for (const width of [375, 1024, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(route);
        await expect(page.locator("h1")).toBeVisible();
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow, `${route} at ${width}px`).toBeLessThanOrEqual(0);
        if (route === "/" && width !== 1440) await page.screenshot({ path: `${SHOTS}/v3-landing-${width}.png` });
      }
    });
  }

  test("every rule value quoted on the landing page carries its UNVERIFIED badge and a source", async ({ page }) => {
    await page.goto("/");
    for (const code of ["CA", "DE", "TX"]) {
      const row = page.getByTestId(`lifecycle-${code}`);
      await expect(row.locator(".mkt-unverified")).toHaveCount(4);
      await expect(row.locator("a.lc-source").first()).toHaveAttribute("href", /^https:\/\//);
    }
  });
});
