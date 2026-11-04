/**
 * Round 8, "misc" slice (R7-04 .. R7-12).
 *  - R7-06: the rule version diff scroll region is keyboard reachable; axe is clean at 375.
 *  - R7-10: Agent runs separates the seed's heuristic baseline from replays.
 *  - R7-11: the replica sign-in carries a same-portal `next`, and ignores an off-portal one.
 *   E2E_PORT=3923 E2E_DIR_SUFFIX=r8misc CI=1 pnpm exec playwright test tests/e2e/ui-r8-misc.spec.ts --project ui
 */
import { mkdirSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "playwright/test";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const SHOTS = ".data/shots/r8-misc";

test.use({ reducedMotion: "reduce" });
test.beforeAll(() => mkdirSync(SHOTS, { recursive: true }));
test.beforeEach(({}, info) => test.skip(info.project.name !== "ui", "runs in the ui project only"));
test.describe.configure({ timeout: 180_000 });

async function axeBlocking(page: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page }).setLegacyMode(true).withTags(WCAG_TAGS).analyze();
  return violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
}
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

for (const width of [375, 1440] as const) {
  test(`R7-06: rule field drawer is axe-clean with no overflow at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
    await page.goto("/rules?state=TX&field=dueDiligence.requiredLanguage", { timeout: 90_000 });
    await expect(page.getByText("Prototype. Not legal advice. Confirm filings with a qualified professional.")).toBeVisible({ timeout: 60_000 });
    const diff = page.getByTestId("version-diff-scroll");
    if (await diff.count()) {
      await expect(diff.first()).toHaveAttribute("tabindex", "0");
      await expect(diff.first()).toHaveAttribute("role", "region");
    }
    expect(await axeBlocking(page)).toEqual([]);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `${SHOTS}/rules-diff-${width}.png`, fullPage: true });
  });

  test(`R7-10: Agent runs labels heuristic baselines honestly at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
    await page.goto("/runs", { timeout: 90_000 });
    await expect(page.getByRole("heading", { name: "Agent runs" })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("runs-count-heuristic")).toBeVisible();
    await expect(page.getByTestId("runs-count-replayed")).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `${SHOTS}/runs-${width}.png`, fullPage: true });
  });
}

test("R7-11: the replica sign-in keeps a same-portal target and refuses an off-portal one", async ({ page }) => {
  await page.goto("/replica/tx-holder/dashboard?filed=REPL-TX-2026-TEST01", { timeout: 90_000 });
  await expect(page).toHaveURL(/\/replica\/tx-holder\?next=/);
  await page.getByTestId("login-username").fill("northwind-demo");
  await page.getByTestId("login-password").fill("replica-only");
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/replica\/tx-holder\/dashboard\?filed=REPL-TX-2026-TEST01/);
  await page.screenshot({ path: `${SHOTS}/replica-next-1440.png` });

  // An off-portal `next` is ignored: a fresh sign-in lands on the plain dashboard.
  await page.context().clearCookies();
  await page.goto(`/replica/tx-holder?next=${encodeURIComponent("https://evil.example/x")}`, { timeout: 90_000 });
  await expect(page.locator('input[name="next"]')).toHaveCount(0);
  await page.getByTestId("login-username").fill("northwind-demo");
  await page.getByTestId("login-password").fill("replica-only");
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/replica\/tx-holder\/dashboard$/);
});
