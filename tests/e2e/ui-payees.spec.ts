/**
 * Payee review (/payees), "ui" group. Read-only against the seeded demo: the merge dialog is opened and cancelled, never
 * confirmed (applying merges is covered by src/lib/payees/review.test.ts), so there is no DB or file state to restore.
 */
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "playwright/test";

const DISCLAIMER = "Prototype. Not legal advice. Confirm filings with a qualified professional.";
const WIDTHS = [375, 1024, 1440] as const;
const SHOTS_DIR = process.env.PAYEES_SHOTS_DIR;

async function openFirstMergeReview(page: Page) {
  const dialog = page.getByTestId("payee-change-dialog");
  const button = page.getByTestId("review-pair").first().getByRole("button", { name: /Review merge/ });
  // The click handler attaches on hydration, which can land after the page looks ready: retry until the dialog opens.
  await expect(async () => {
    await button.click();
    await expect(dialog).toBeVisible({ timeout: 1_500 });
  }).toPass({ timeout: 20_000 });
  return dialog;
}

async function overflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

test.describe("payees page", () => {
  test("renders clusters, the review queue, the nav entry and the disclaimer", async ({ page }) => {
    await page.goto("/payees");
    await expect(page.getByRole("heading", { name: "Payees", level: 1 })).toBeVisible();
    await expect(page.getByRole("table", { name: "Payees" })).toBeVisible();
    await expect(page.getByTestId("payee-row").first()).toBeVisible();
    await expect(page.getByTestId("review-queue")).toBeVisible();
    expect(await page.locator("[data-testid='payee-row'][data-review]").count()).toBeGreaterThan(0);
    await expect(page.getByTestId("payees-footer")).toContainText(/\d+ of \d+ payees/);
    await expect(page.getByText(DISCLAIMER)).toBeVisible();
    await expect(page.getByRole("link", { name: "Payees" }).first()).toHaveAttribute("href", "/payees");
  });

  test("search and filters live in the URL and narrow the table", async ({ page }) => {
    await page.goto("/payees");
    const rows = page.getByTestId("payee-row");
    await expect(rows.first()).toBeVisible();
    const total = await rows.count();

    await expect(async () => {
      await page.getByRole("searchbox", { name: "Search payee or alias" }).fill("copperline");
      await expect(page).toHaveURL(/q=copperline/, { timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
    await expect(rows.first()).toContainText(/copperline/i);
    expect(await rows.count()).toBeLessThan(total);

    await page.goto("/payees?show=review");
    await expect(page.getByTestId("payee-row").first()).toBeVisible();
    const flagged = await page.getByTestId("payee-row").count();
    expect(flagged).toBe(await page.locator("[data-testid='payee-row'][data-review]").count());
    await expect(page.getByLabel("Show")).toHaveValue("review");
  });

  test("the merge dialog shows the owner-state diff, and cancelling changes nothing", async ({ page }) => {
    await page.goto("/payees");
    await expect(page.getByTestId("review-pair").first()).toBeVisible();
    const footerBefore = await page.getByTestId("payees-footer").innerText();
    const pairsBefore = await page.getByTestId("review-pair").allInnerTexts();

    const dialog = await openFirstMergeReview(page);
    await expect(dialog.getByRole("heading", { name: "Merge payees" })).toBeVisible();
    await expect(dialog.getByTestId("payee-diff-summary").or(dialog.getByText("Nothing to change."))).toBeVisible();
    await expect(dialog.getByTestId("payee-diff").or(dialog.getByTestId("payee-diff-empty"))).toBeVisible();
    // Confirming needs a reviewer name.
    await expect(dialog.getByTestId("payee-change-confirm")).toBeDisabled();
    await dialog.getByLabel(/Your name/).fill("E2E Reviewer");
    await expect(dialog.getByTestId("payee-change-confirm")).toBeEnabled();

    await dialog.getByTestId("payee-change-cancel").click();
    await expect(dialog).toBeHidden();

    await page.reload();
    await expect(page.getByTestId("payees-footer")).toHaveText(footerBefore);
    expect(await page.getByTestId("review-pair").allInnerTexts()).toEqual(pairsBefore);
    await expect(page.getByTestId("payee-notice")).toHaveCount(0);
  });

  test("the drawer lists the payee's items with links into /items", async ({ page }) => {
    await page.goto("/payees?show=items");
    const first = page.getByTestId("payee-row").first();
    await expect(first).toBeVisible();
    const name = (await first.getByRole("button").first().innerText()).trim();
    await expect(async () => {
      await first.getByRole("button", { name: `Open ${name}` }).click();
      await expect(page).toHaveURL(/payee=/, { timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
    const drawer = page.getByTestId("payee-drawer");
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole("heading", { name })).toBeVisible();
    const link = drawer.getByTestId("payee-items").getByRole("link").first();
    await expect(link).toHaveAttribute("href", /^\/items\?item=/);
    await expect(drawer.getByRole("button", { name: "Review rename" })).toBeDisabled();
  });
});

test.describe("payees layout and accessibility", () => {
  for (const width of WIDTHS) {
    test(`no horizontal overflow at ${width}px, including with the dialog open`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/payees");
      await expect(page.getByTestId("payee-row").first()).toBeVisible();
      expect(await overflow(page)).toBeLessThanOrEqual(0);
      const dialog = await openFirstMergeReview(page);
      await expect(dialog.getByTestId("payee-diff").or(dialog.getByTestId("payee-diff-empty"))).toBeVisible();
      expect(await overflow(page)).toBeLessThanOrEqual(0);
    });
  }

  for (const width of [1440, 375] as const) {
    test(`axe finds no serious or critical issues at ${width}px (page, drawer and dialog)`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      const blocking = async (label: string) => {
        const res = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
        return res.violations
          .filter((v) => v.impact === "serious" || v.impact === "critical")
          .map((v) => `${label}: [${v.impact}] ${v.id} ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" ; ")}`);
      };
      await page.goto("/payees?show=items");
      await expect(page.getByTestId("payee-row").first()).toBeVisible();
      const found = await blocking("page");

      const first = page.getByTestId("payee-row").first();
      const name = (await first.getByRole("button").first().innerText()).trim();
      await expect(async () => {
        await first.getByRole("button", { name: `Open ${name}` }).click();
        await expect(page.getByTestId("payee-drawer")).toBeVisible({ timeout: 2_000 });
        await expect(page.getByTestId("payee-drawer-body")).toBeVisible({ timeout: 5_000 });
      }).toPass({ timeout: 20_000 });
      found.push(...(await blocking("drawer")));

      await page.goto("/payees");
      const dialog = await openFirstMergeReview(page);
      await expect(dialog.getByTestId("payee-diff").or(dialog.getByTestId("payee-diff-empty"))).toBeVisible();
      found.push(...(await blocking("dialog")));
      expect(found).toEqual([]);
    });
  }
});

test.describe("payees screenshots (only with PAYEES_SHOTS_DIR)", () => {
  test.skip(!SHOTS_DIR, "set PAYEES_SHOTS_DIR to capture screenshots");
  for (const width of [375, 1440] as const) {
    test(`capture ${width}`, async ({ page }) => {
      mkdirSync(SHOTS_DIR!, { recursive: true });
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto("/payees");
      await expect(page.getByTestId("review-queue")).toBeVisible();
      await page.screenshot({ path: `${SHOTS_DIR}/payees-${width}.png`, fullPage: true });
      await openFirstMergeReview(page);
      await expect(page.getByTestId("payee-diff").or(page.getByTestId("payee-diff-empty"))).toBeVisible();
      await page.screenshot({ path: `${SHOTS_DIR}/payees-${width}-merge-dialog.png` });
    });
  }
});
