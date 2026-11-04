/**
 * Round 8 feature: Audit Drill (/audit). Read-only, so it never disturbs the state other ui specs rely on.
 *  - simulating a DE audit twice draws the identical sample (sha256 of state + demo date + size);
 *  - readiness is below 100% on the seed (its rules are UNVERIFIED);
 *  - a pink "Rule UNVERIFIED" link has a Fix link that opens /rules?state=DE;
 *  - the binder is a PDF; no POST is sent while drilling; axe clean, no overflow at 375/1024/1440.
 *   E2E_PORT=3925 E2E_DIR_SUFFIX=r8audit CI=1 pnpm exec playwright test tests/e2e/ui-audit-drill.spec.ts --project ui
 */
import { mkdirSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "playwright/test";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const SHOTS = ".data/shots/r8-books";
const DISCLAIMER = "Prototype. Not legal advice. Confirm filings with a qualified professional.";

test.use({ reducedMotion: "reduce" });
test.beforeAll(() => mkdirSync(SHOTS, { recursive: true }));
test.beforeEach(({}, info) => test.skip(info.project.name !== "ui", "runs in the ui project only"));
test.describe.configure({ timeout: 180_000 });

async function axeBlocking(page: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page }).setLegacyMode(true).withTags(WCAG_TAGS).analyze();
  return violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
}
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

async function simulate(page: Page, state: "CA" | "DE" | "TX"): Promise<string[]> {
  await page.goto("/audit", { timeout: 90_000 });
  await expect(page.getByText(DISCLAIMER)).toBeVisible({ timeout: 60_000 });
  await page.locator(`label:has([data-testid="audit-state-${state}"])`).click();
  await page.getByTestId("audit-simulate").click();
  await expect(page).toHaveURL(new RegExp(`/audit\\?state=${state}`));
  const items = page.getByTestId("audit-item");
  await expect(items.first()).toBeVisible({ timeout: 60_000 });
  return items.evaluateAll((els) => els.map((e) => e.getAttribute("data-item-id") ?? ""));
}

test("a DE audit drill is reproducible, honest about UNVERIFIED rules, and read-only", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const posts: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST") posts.push(r.url());
  });

  const first = await simulate(page, "DE");
  const second = await simulate(page, "DE");
  expect(first.length).toBeGreaterThan(0);
  expect(second).toEqual(first);
  await expect(page.getByTestId("proof-chain").first().getByTestId("proof-link")).toHaveCount(9);

  const pct = Number(await page.getByTestId("readiness-gauge").getAttribute("data-pct"));
  expect(Number.isFinite(pct)).toBe(true);
  expect(pct).toBeLessThan(100);

  // R8-07: the state-wide rules gap is ONE action and is labelled a rules gap, never a missing proof.
  const gaps = page.locator('[data-testid="proof-link"][data-kind="rule"][data-status="rules_gap"]');
  expect(await gaps.count()).toBeGreaterThan(1);
  await expect(page.locator('[data-testid="proof-link"][data-kind="rule"][data-status="missing"]')).toHaveCount(0);
  await expect(gaps.first().getByTestId("proof-status")).toContainText("Rules gap");
  await expect(page.getByTestId("audit-results")).toContainText("1 action: verify the DE rules.");

  const binderHref = await page.getByTestId("audit-binder").getAttribute("href");
  expect(binderHref).toMatch(/^\/api\/audit\/DE\/binder\?size=5$/);
  const pdf = await page.request.get(binderHref!);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  expect((await pdf.body()).subarray(0, 5).toString("latin1")).toBe("%PDF-");

  await page.screenshot({ path: `${SHOTS}/audit-de-1440.png`, fullPage: true });
  expect(posts).toEqual([]);

  const rule = page.locator('[data-testid="proof-link"][data-kind="rule"][data-status="rules_gap"]').filter({ hasText: "Rule UNVERIFIED" }).first();
  await expect(rule).toBeVisible();
  const fix = rule.getByTestId("proof-fix");
  await expect(fix).toHaveAttribute("href", "/rules?state=DE");
  await fix.click();
  await expect(page).toHaveURL(/\/rules\?state=DE$/);
  await expect(page.getByRole("heading", { name: "Rules", level: 1 })).toBeVisible({ timeout: 60_000 });
});

test("the request form reads the same sample from a shared URL and the All items toggle", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/audit?state=TX&size=10", { timeout: 90_000 });
  await expect(page.getByTestId("audit-item").first()).toBeVisible({ timeout: 60_000 });
  const ten = await page.getByTestId("audit-item").count();
  expect(ten).toBeLessThanOrEqual(10);
  await page.getByTestId("audit-all").check();
  await page.getByTestId("audit-simulate").click();
  await expect(page).toHaveURL(/all=true/);
  await expect(page.getByTestId("audit-binder")).toHaveAttribute("href", /all=true/);
  expect(await page.getByTestId("audit-item").count()).toBeGreaterThanOrEqual(ten);
});

for (const width of [375, 1024, 1440] as const) {
  test(`audit drill is axe-clean with no overflow at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
    await page.goto("/audit?state=DE&size=5", { timeout: 90_000 });
    await expect(page.getByText(DISCLAIMER)).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("audit-item").first()).toBeVisible({ timeout: 60_000 });
    expect(await axeBlocking(page)).toEqual([]);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `${SHOTS}/audit-de-${width}.png`, fullPage: width !== 375 });
  });
}

test("the empty request form is axe-clean at 375", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/audit", { timeout: 90_000 });
  await expect(page.getByTestId("audit-simulate")).toBeVisible({ timeout: 60_000 });
  expect(await axeBlocking(page)).toEqual([]);
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `${SHOTS}/audit-intro-375.png`, fullPage: true });
});

test("R8-21: proof-chain card text is never cut off with an ellipsis at 1440", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/audit?state=DE&size=5", { timeout: 90_000 });
  await expect(page.getByTestId("audit-item").first()).toBeVisible({ timeout: 60_000 });
  const clipped = await page.evaluate(() => {
    const out: string[] = [];
    for (const el of document.querySelectorAll('[data-testid="proof-link"] p, [data-testid="proof-link"] a > span:not(.sr-only), [data-testid="audit-item"] h3')) {
      if (el.closest(".sr-only")) continue;
      const cs = getComputedStyle(el);
      const lineClamp = cs.getPropertyValue("-webkit-line-clamp");
      const truncated = cs.textOverflow === "ellipsis" || (lineClamp !== "none" && lineClamp !== "") || (el.scrollHeight > el.clientHeight + 1 && cs.overflow !== "visible");
      if (truncated) out.push((el.textContent ?? "").slice(0, 60));
    }
    return out;
  });
  expect(clipped).toEqual([]);
  await page.screenshot({ path: `${SHOTS}/audit-de-cards-1440.png`, fullPage: true });
});
