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

/**
 * The tier comes from the device (src/components/viz/core/render-tier.ts): <= 4 cores or <= 4 GB is "lite", no WebGL2
 * is "lite", and a renderer that cannot get a context drops to "static" (poster only). CI runners have 4 vCPUs and
 * no GPU, so the hardware signals are pinned here and WebGL availability is probed, never assumed.
 */
async function pinCapableHardware(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, "hardwareConcurrency", { get: () => 8, configurable: true });
    Object.defineProperty(Navigator.prototype, "deviceMemory", { get: () => 8, configurable: true });
  });
}

/** Records every data-tier the hero's LazyCanvas passes through and the tier the scene first mounted at. */
async function recordVaultTiers(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __vault: { tiers: string[]; mounted: string | null } };
    w.__vault = { tiers: [], mounted: null };
    new MutationObserver((muts) => {
      for (const m of muts) {
        const el = m.target as HTMLElement;
        if (m.attributeName === "data-tier" && el.dataset.tier) w.__vault.tiers.push(el.dataset.tier);
        if (m.attributeName === "data-mounted-tier" && !w.__vault.mounted) w.__vault.mounted = el.dataset.mountedTier ?? null;
      }
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ["data-tier", "data-mounted-tier"] });
  });
}

const vaultState = (page: Page) => page.evaluate(() => (window as unknown as { __vault: { tiers: string[]; mounted: string | null } }).__vault);

async function expectPosterAndLabels(page: Page): Promise<void> {
  const hero = page.getByTestId("hero-vault");
  await expect(hero.locator('img[src*="vault-poster"]')).toBeVisible();
  // Labels are DOM over the poster, present before (and without) any WebGL.
  await expect(hero.locator('[data-label="CA"]')).toBeAttached();
  await expect(hero.locator('[data-label="gate"]')).toContainText("Needs your approval");
}

/** The scene was tried (the tier left "static") and fell back to the poster: no canvas, the poster and labels stay. */
async function expectPosterFallback(page: Page): Promise<void> {
  const hero = page.getByTestId("hero-vault");
  await expect.poll(async () => (await vaultState(page)).tiers.some((t) => t !== "static"), { timeout: SCENE_TIMEOUT }).toBe(true);
  await expect(hero.locator("[data-tier]")).toHaveAttribute("data-tier", "static", { timeout: SCENE_TIMEOUT });
  await expect(hero.locator("canvas")).toHaveCount(0);
  await expectPosterAndLabels(page);
}

test.describe("The Vault", () => {
  test("the hero shows the poster immediately, then the canvas mounts after idle at the full tier (poster fallback without WebGL)", async ({ page }) => {
    test.setTimeout(SCENE_TIMEOUT + 60_000);
    await pinCapableHardware(page);
    await recordVaultTiers(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expectPosterAndLabels(page);

    const webgl = await page.evaluate(() => {
      const c = document.createElement("canvas");
      return { webgl2: !!c.getContext("webgl2"), webgl: !!document.createElement("canvas").getContext("webgl") };
    });
    test.info().annotations.push({ type: "webgl", description: JSON.stringify(webgl) });
    if (!webgl.webgl2 && !webgl.webgl) {
      // No GPU and no software GL in this browser: the honest result is the static poster.
      await expectPosterFallback(page);
      await page.screenshot({ path: `${SHOTS}/v3-landing-1440.png` });
      return;
    }

    const scene = page.getByTestId("hero-vault").getByTestId("vault-canvas");
    // First mount, recorded as it happens: the FPS probe may lower the tier afterwards on a slow software renderer.
    await expect.poll(async () => (await vaultState(page)).mounted, { timeout: SCENE_TIMEOUT }).toBe(webgl.webgl2 ? "full" : "lite");
    await expect(page.getByTestId("hero-vault").locator('img[src*="vault-poster"]')).toBeAttached();
    if (await scene.count()) await expect(scene.locator("canvas")).toBeAttached();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${SHOTS}/v3-landing-1440.png` });
  });

  test("with WebGL unavailable the poster stays and no canvas is left behind", async ({ page }) => {
    test.setTimeout(SCENE_TIMEOUT + 60_000);
    await pinCapableHardware(page);
    await recordVaultTiers(page);
    await page.addInitScript(() => {
      const orig = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
        if (/webgl/i.test(type)) return null;
        return (orig as (...a: unknown[]) => RenderingContext | null).call(this, type, ...rest);
      } as typeof orig;
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expectPosterFallback(page);
    // The scene was attempted at "lite" (no WebGL2) and gave up: it never mounted.
    expect((await vaultState(page)).mounted).toBeNull();
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
