/**
 * Approvals polish: opaque action footer, last content clear of it, empty recipient with allowlist chips,
 * no developer text, axe and overflow clean. Nothing is sent. Screenshots: .data/shots/approvals-polish-{375,1440}.png.
 */
import { mkdirSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "playwright/test";
import { E2E_SECRETS } from "./env";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const SHOTS = ".data/shots";
const DEV_TEXT = /ALLOWED_TEST_RECIPIENTS|ALLOWED_TEST_PHONES|variables_source|OWNER_LINK_SECRET|APP_BASE_URL/;

test.describe.configure({ mode: "serial" });
test.beforeAll(() => mkdirSync(SHOTS, { recursive: true }));

async function axeBlocking(page: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page }).setLegacyMode(true).withTags(WCAG_TAGS).analyze();
  return violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
}

let emailKey: string | null = null;

/** Opens the first owner's detail, drafts and composes the email step, and returns its queue key. */
async function prepareEmailDraft(page: Page): Promise<string> {
  await page.goto("/approvals");
  await expect(page.locator("[data-key]").first()).toBeVisible({ timeout: 30_000 });
  // The second owner: the pre-existing approvals spec drives the first owner and expects it untouched.
  await page.locator("[data-key^='o:']").nth(1).click();
  const detail = page.getByTestId("approval-detail");
  const seq = detail.getByTestId("channel-sequence");
  await expect(seq).toBeVisible();
  const emailButton = seq.getByRole("button", { name: /^Email\b/ });
  if (!(await emailButton.count())) {
    const drafted = page.waitForResponse((r) => r.url().endsWith("/api/outreach/draft") && r.request().method() === "POST");
    await seq.getByRole("button", { name: "Draft email" }).click();
    expect((await drafted).status()).toBe(201);
  }
  await expect(emailButton).toHaveAttribute("aria-pressed", "true", { timeout: 20_000 });
  const compose = detail.getByTestId("compose-btn");
  if (await compose.isVisible()) await compose.click();
  await expect(compose).toBeHidden({ timeout: 30_000 });
  const key = await page.locator("[data-key][aria-current='true']").first().getAttribute("data-key");
  expect(key).toMatch(/^o:/);
  return key!;
}

test("recipient starts empty and an allowlist chip fills it (masked)", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  emailKey = await prepareEmailDraft(page);
  const detail = page.getByTestId("approval-detail");
  const input = detail.getByTestId("recipient-input");
  await expect(input).toHaveValue("");
  const chips = detail.getByTestId("allowlist-chip");
  await expect(chips.first()).toBeVisible();
  // R4-24: chips (and the filled field) show a masked address; the full value stays on the server.
  const full = E2E_SECRETS.ALLOWED_TEST_RECIPIENTS;
  const masked = `${full[0]}\u2022\u2022\u2022${full.slice(full.indexOf("@"))}`;
  await chips.filter({ hasText: masked }).first().click();
  await expect(input).toHaveValue(masked);
  await expect(detail.getByText(/Recipient is on the test allowlist/i)).toBeVisible();
});

for (const width of [375, 1024, 1440] as const) {
  test(`footer is dense glass and clear of the last content at ${width}`, async ({ page }) => {
    test.setTimeout(90_000);
    expect(emailKey, "email draft from the previous test").toBeTruthy();
    await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
    await page.goto(`/approvals?sel=${emailKey}`);
    const detail = page.getByTestId("approval-detail");
    await expect(detail.getByTestId("approve-bar")).toBeVisible({ timeout: 30_000 });
    await page.waitForLoadState("networkidle").catch(() => undefined);

    const bar = detail.getByTestId("approve-bar");
    // V4 glass footer: not fully opaque, but dense enough (>= 85% navy plus a blur) that the content scrolling behind it
    // can never hurt legibility. Prove it: composite the bar over the worst case (white) and check the text contrast.
    const probe = await bar.evaluate((el) => {
      const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
      const rgba = (css: string): [number, number, number, number] => {
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = "#000";
        ctx.fillStyle = css;
        ctx.fillRect(0, 0, 1, 1);
        const d = ctx.getImageData(0, 0, 1, 1).data;
        return [d[0]!, d[1]!, d[2]!, d[3]! / 255];
      };
      const lin = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      const lum = (c: number[]) => 0.2126 * lin(c[0]!) + 0.7152 * lin(c[1]!) + 0.0722 * lin(c[2]!);
      const bg = rgba(getComputedStyle(el).backgroundColor);
      const over = [0, 1, 2].map((k) => bg[k]! * bg[3] + 255 * (1 - bg[3]));
      let minContrast = Infinity;
      for (const t of Array.from(el.querySelectorAll<HTMLElement>("*"))) {
        const own = Array.from(t.childNodes).some((n) => n.nodeType === 3 && (n.textContent ?? "").trim() !== "");
        if (!own || t.closest("button:disabled")) continue;
        const c = rgba(getComputedStyle(t).color);
        const fg = [0, 1, 2].map((k) => c[k]! * c[3] + over[k]! * (1 - c[3]));
        const [hi, lo] = [lum(fg), lum(over)].sort((a, b) => b - a);
        minContrast = Math.min(minContrast, (hi! + 0.05) / (lo! + 0.05));
      }
      return { alpha: bg[3], blur: getComputedStyle(el).backdropFilter, minContrast };
    });
    expect(probe.alpha, "footer background alpha").toBeGreaterThanOrEqual(0.85);
    expect(probe.blur, "footer blurs what scrolls behind it").toContain("blur");
    expect(probe.minContrast, "footer text contrast over the worst-case backdrop").toBeGreaterThanOrEqual(4.5);

    // Scroll every scrollable ancestor (and the page) to its end.
    await bar.evaluate((el) => {
      for (let a: HTMLElement | null = el.parentElement; a; a = a.parentElement) a.scrollTop = a.scrollHeight;
      window.scrollTo(0, document.documentElement.scrollHeight);
    });
    const { lastBottom, barTop } = await bar.evaluate((el) => {
      const last = el.previousElementSibling?.lastElementChild as HTMLElement | null;
      return { lastBottom: last?.getBoundingClientRect().bottom ?? -1, barTop: el.getBoundingClientRect().top };
    });
    expect(lastBottom).toBeGreaterThan(0);
    expect(lastBottom, "last body element sits above the footer").toBeLessThanOrEqual(barTop + 0.5);

    // No developer text anywhere on the page, no horizontal overflow, axe clean.
    await expect(page.locator("body")).not.toContainText(DEV_TEXT);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    expect(await axeBlocking(page), `axe @${width}`).toEqual([]);
    await expect(page.getByText("Prototype. Not legal advice. Confirm filings with a qualified professional.")).toBeVisible();
    if (width !== 1024) await page.screenshot({ path: `${SHOTS}/approvals-polish-${width}.png` });
  });
}
