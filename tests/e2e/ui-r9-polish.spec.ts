/**
 * Round 9, P3 polish (R9-06 .. R9-09, R9-13, R9-15).
 *  - R9-06: chat cards never print "1 items" / "1 states" (offline server only, like the other chat specs).
 *  - R9-07: the clock-detection toast (toast.info) is electric blue, not the neutral toast surface.
 *  - R9-08: Approvals with a letter preview selected logs no console error from the sandboxed frame.
 *  - R9-09: What-if chips toggle off again; "Do nothing" is a disabled baseline with honest copy.
 *  - R9-15: Settings shows no skeleton flash on a quick navigation (inner skeletons stay hidden for the first 250 ms).
 *  - axe (legacy mode) clean and no horizontal overflow at 375/1024/1440 on What-if and Settings.
 * Unit tests cover R9-11 (remittance mismatch), R9-12 (email readiness) and R9-13 (Sent date).
 *   ESCHEAT_OFFLINE=1 E2E_PORT=3988 E2E_DIR_SUFFIX=r9p3 CI=1 pnpm exec playwright test tests/e2e/ui-r9-polish.spec.ts --project ui
 */
import { mkdirSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "playwright/test";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const SHOTS = ".data/shots/r9-polish";
const WIDTHS = [375, 1024, 1440] as const;

test.use({ reducedMotion: "reduce" });
test.beforeAll(() => mkdirSync(SHOTS, { recursive: true }));
test.beforeEach(({}, info) => test.skip(info.project.name !== "ui", "runs in the ui project only"));
test.describe.configure({ timeout: 240_000 });

const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

async function axeBlocking(page: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page }).setLegacyMode(true).withTags(WCAG_TAGS).analyze();
  return violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
}

test("R9-06: the chat exposure card pluralises its counts", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/chat", { timeout: 90_000 });
  await expect(page.getByTestId("chat-input")).toBeVisible({ timeout: 30_000 });
  test.skip(!((await page.getByTestId("chat-model").textContent()) ?? "").includes("offline"), "Needs the e2e server started with ESCHEAT_OFFLINE=1");
  await page.getByTestId("chat-example").filter({ hasText: "What do we owe and where?" }).click();
  const last = page.getByTestId("chat-assistant-message").last();
  await expect(last).toHaveAttribute("data-status", "done", { timeout: 60_000 });
  expect(await last.innerText()).not.toMatch(/\b1 (items|states|days)\b/);
});

test("R9-07: the clock-detection toast is electric blue, not the neutral toast surface", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/dashboard", { timeout: 120_000 });
  await expect(page.getByTestId("demo-date")).toBeVisible({ timeout: 90_000 });
  try {
    await page.getByRole("button", { name: /^Demo clock/ }).click();
    const respP = page.waitForResponse((r) => r.url().endsWith("/api/clock") && r.request().method() === "POST");
    await page.getByRole("button", { name: "+90d" }).click();
    const json = (await (await respP).json()) as { detected: { count: number } };
    test.skip(json.detected.count === 0, "The move detected nothing, so there is no info toast to colour");
    const toast = page.locator("[data-sonner-toast][data-type='info']", { hasText: /detected ·/ });
    await expect(toast).toBeVisible({ timeout: 30_000 });
    const same = await toast.evaluate((el) => {
      const probe = (cssVar: string) => {
        const p = document.createElement("div");
        p.style.cssText = `position:fixed;background:var(${cssVar});border:1px solid var(${cssVar})`;
        document.body.appendChild(p);
        const c = getComputedStyle(p).backgroundColor;
        p.remove();
        return c;
      };
      const cs = getComputedStyle(el);
      return { bg: cs.backgroundColor, border: cs.borderTopColor, blueBg: probe("--color-blue-900"), blueBorder: probe("--color-blue-500"), neutralBg: probe("--color-ink-3") };
    });
    expect(same.bg).toBe(same.blueBg);
    expect(same.border).toBe(same.blueBorder);
    expect(same.bg).not.toBe(same.neutralBg);
    await page.screenshot({ path: `${SHOTS}/clock-toast-1440.png` });
  } finally {
    await page.request.post("/api/clock", { data: { action: "reset" } });
  }
});

test("R9-08: a selected letter preview leaves the console clean", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/approvals", { timeout: 90_000 });
  const rows = page.locator("[data-key^='o:']");
  await expect(rows.first()).toBeVisible({ timeout: 30_000 });
  const keys = await rows.evaluateAll((els) => els.map((e) => e.getAttribute("data-key")));
  for (const k of keys.slice(0, 3)) {
    await page.goto(`/approvals?sel=${k}`);
    const preview = page.getByTestId("letter-preview");
    if (await preview.count()) {
      await preview.scrollIntoViewIfNeeded();
      await page.waitForTimeout(1_500);
    }
  }
  expect(errors.filter((e) => /sandbox|Blocked script/i.test(e))).toEqual([]);
});

test("R9-09: What-if chips toggle off again, and Do nothing is an honest baseline", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/what-if", { timeout: 90_000 });
  await expect(page.getByTestId("what-if")).toBeVisible({ timeout: 30_000 });
  const nothing = page.getByTestId("wi-chip-nothing");
  await expect(nothing).toHaveAttribute("aria-pressed", "true");
  await expect(nothing).toBeDisabled();
  await expect(page.getByTestId("wi-baseline-note")).toContainText("baseline");

  for (const key of ["all-on-time", "largest-respond"]) {
    const chip = page.getByTestId(`wi-chip-${key}`);
    await chip.click();
    await expect(chip).toHaveAttribute("aria-pressed", "true");
    await expect(nothing).toBeEnabled();
    await expect(nothing).toHaveAttribute("aria-pressed", "false");
    await chip.click();
    await expect(chip).toHaveAttribute("aria-pressed", "false");
    await expect.poll(() => new URL(page.url()).search).toBe("");
    await expect(nothing).toBeDisabled();
  }

  // Do nothing at a later date is still the baseline choice set, and says that only time passed.
  await page.getByRole("button", { name: "+90d" }).click();
  await expect(page.getByTestId("wi-baseline-note")).toContainText("Only time has passed");
  // With a choice made, Do nothing clears it.
  await page.getByTestId("wi-chip-all-on-time").click();
  await nothing.click();
  await expect(page.getByTestId("wi-chip-all-on-time")).toHaveAttribute("aria-pressed", "false");
  await page.screenshot({ path: `${SHOTS}/what-if-1440.png` });
});

test("R9-15: Settings does not flash a skeleton on a quick navigation", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/dashboard", { timeout: 120_000 });
  await expect(page.locator("main h1").first()).toBeVisible({ timeout: 90_000 });
  await page.request.get("/settings/integrations").catch(() => undefined);
  await page.evaluate(() => {
    const w = window as unknown as { __flash: number[] };
    w.__flash = [];
    let since: number | null = null;
    const tick = () => {
      const shown = [...document.querySelectorAll('main [aria-busy="true"]')].some((el) => getComputedStyle(el).visibility === "visible");
      const t = performance.now();
      if (shown && since === null) since = t;
      if (!shown && since !== null) {
        w.__flash.push(Math.round(t - since));
        since = null;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.getByRole("complementary", { name: "Sidebar" }).locator('a[href="/settings/integrations"]').click();
  await expect(page).toHaveURL(/\/settings\/integrations$/, { timeout: 90_000 });
  await expect(page.locator('main [aria-busy="true"]')).toHaveCount(0, { timeout: 90_000 });
  await page.waitForTimeout(300);
  const flashes = await page.evaluate(() => (window as unknown as { __flash: number[] }).__flash);
  // A skeleton may show when the wait is real, but never as a blink: nothing visible for under 100 ms.
  expect(flashes.filter((ms) => ms < 100), `visible skeleton durations (ms): ${flashes.join(",")}`).toEqual([]);
});

for (const width of WIDTHS) {
  for (const path of ["/what-if", "/settings/integrations"]) {
    test(`${path}: axe-clean and no overflow at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
      await page.goto(path, { timeout: 90_000 });
      await expect(page.locator("main h1").first()).toBeVisible({ timeout: 60_000 });
      await expect(page.locator('main [aria-busy="true"]')).toHaveCount(0, { timeout: 60_000 });
      expect(await overflow(page), `overflow at ${width}`).toBeLessThanOrEqual(0);
      expect(await axeBlocking(page), `axe at ${width}`).toEqual([]);
      await page.screenshot({ path: `${SHOTS}/${path.replace(/\W+/g, "-").slice(1)}-${width}.png` });
    });
  }
}
