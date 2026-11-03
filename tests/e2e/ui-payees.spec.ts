/**
 * Payee review (/payees), "ui" group. Read-only against the seeded demo: the merge dialog is opened and cancelled, never
 * confirmed (applying merges is covered by src/lib/payees/review.test.ts), so there is no DB or file state to restore.
 */
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "playwright/test";
import { finishAnimations } from "./animations";

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

/** Collects browser console errors and uncaught exceptions for the life of the page. */
function trackConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console.error: ${m.text().slice(0, 400)}`);
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message.slice(0, 400)}`));
  return errors;
}

/** Wait for hydration to settle and every running animation (dialog, drawer) to finish. */
async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  await finishAnimations(page);
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
    await expect(page.getByTestId("payees-footer")).toContainText(/Showing 1 to \d+ of \d+ payees/);
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

  test("only real decisions are flagged; the rest are a quiet, collapsed list", async ({ page }) => {
    await page.goto("/payees");
    await expect(page.getByTestId("review-queue")).toBeVisible();
    const decisions = await page.getByTestId("review-pair").count();
    expect(decisions).toBeGreaterThan(0);
    expect(decisions).toBeLessThanOrEqual(10);
    const flaggedRows = await page.locator("[data-testid='payee-row'][data-review]").count();
    expect(flaggedRows).toBeLessThanOrEqual(12);
    const quiet = page.getByTestId("quiet-duplicates");
    await expect(quiet).toBeVisible();
    await expect(quiet.locator("summary")).toHaveText(/\d+ other possible duplicates? \(no money at stake\)/);
    expect(await quiet.evaluate((el) => (el as HTMLDetailsElement).open)).toBe(false);
    await expect(page.getByTestId("quiet-pair").first()).toBeHidden();
  });

  test("the default view is payees with open items and the table paginates through the URL", async ({ page }) => {
    await page.goto("/payees");
    await expect(page.getByLabel("Show")).toHaveValue("open");
    await page.goto("/payees?show=all");
    await expect(page.getByTestId("payee-row")).toHaveCount(25);
    await expect(page.getByTestId("payees-page")).toHaveText("Page 1 of 7");
    await expect(async () => {
      await page.getByRole("navigation", { name: "Pagination" }).getByRole("button", { name: "Next" }).click();
      await expect(page).toHaveURL(/page=2/, { timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
    await expect(page.getByTestId("payees-page")).toHaveText("Page 2 of 7");
    await expect(page.getByTestId("payees-footer")).toContainText(/Showing 26 to 50 of \d+ payees/);
    await page.getByRole("navigation", { name: "Pagination" }).getByRole("button", { name: "Previous" }).click();
    await expect(page.getByTestId("payees-page")).toHaveText("Page 1 of 7");
  });

  test("a merge keeps the properly cased name by default and the direction can be swapped", async ({ page }) => {
    await page.goto("/payees");
    const row = page.getByTestId("review-pair").filter({ hasText: "BAYLINE ELEC" }).first();
    await expect(row).toContainText("Bayline Electric and BAYLINE ELEC");
    const dialog = page.getByTestId("payee-change-dialog");
    await expect(async () => {
      await row.getByRole("button", { name: /Review merge/ }).click();
      await expect(dialog).toBeVisible({ timeout: 1_500 });
    }).toPass({ timeout: 20_000 });
    const direction = dialog.getByTestId("merge-direction");
    await expect(direction).toContainText("Keep Bayline Electric as the canonical name");
    await expect(dialog.getByTestId("payee-diff-summary")).toHaveText(/^\d+ items? (moves|move) with this change/);
    await dialog.getByTestId("payee-change-swap").click();
    await expect(direction).toContainText("Keep BAYLINE ELEC as the canonical name");
    await dialog.getByTestId("payee-change-swap").click();
    await expect(direction).toContainText("Keep Bayline Electric as the canonical name");
    await dialog.getByTestId("payee-change-cancel").click();
    await expect(dialog).toBeHidden();
  });

  test("logs no console errors while loading, searching, opening the drawer and the merge dialog", async ({ page }) => {
    const errors = trackConsoleErrors(page);
    await page.goto("/payees");
    await settle(page);
    await page.getByRole("searchbox", { name: "Search payee or alias" }).fill("bayline");
    await expect(page).toHaveURL(/q=bayline/, { timeout: 15_000 });
    await settle(page);
    const first = page.getByTestId("payee-row").first();
    const name = (await first.getByRole("button").first().innerText()).trim();
    await expect(async () => {
      await first.getByRole("button", { name: `Open ${name}` }).click();
      await expect(page.getByTestId("payee-drawer-body")).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
    await page.getByRole("button", { name: "Close payee details" }).click();
    await page.goto("/payees");
    await openFirstMergeReview(page);
    await expect(page.getByTestId("payee-diff").or(page.getByTestId("payee-diff-empty"))).toBeVisible();
    await settle(page);
    expect(errors).toEqual([]);
  });

  test("the merge dialog shows the owner-state diff, and cancelling changes nothing", async ({ page }) => {
    await page.goto("/payees");
    await expect(page.getByTestId("review-pair").first()).toBeVisible();
    const footerBefore = (await page.getByTestId("payees-footer").textContent()) ?? "";
    const pairsBefore = await page.getByTestId("review-pair").allTextContents();

    const dialog = await openFirstMergeReview(page);
    await expect(dialog.getByRole("heading", { name: "Merge payees" })).toBeVisible();
    await expect(dialog.getByTestId("payee-diff-summary").or(dialog.getByText("Nothing to change."))).toBeVisible();
    await expect(dialog.getByTestId("payee-diff").or(dialog.getByTestId("payee-diff-empty"))).toBeVisible();
    // Confirming needs a reviewer name. F33 pre-fills it from the session, so clear it first.
    await dialog.getByTestId("payee-change-name").fill("");
    await expect(dialog.getByTestId("payee-change-confirm")).toBeDisabled();
    await dialog.getByTestId("payee-change-name").fill("E2E Reviewer");
    await expect(dialog.getByTestId("payee-change-confirm")).toBeEnabled();

    await dialog.getByTestId("payee-change-cancel").click();
    await expect(dialog).toBeHidden();

    await page.reload();
    await expect(page.getByTestId("payees-footer")).toHaveText(footerBefore);
    expect(await page.getByTestId("review-pair").allTextContents()).toEqual(pairsBefore);
    await expect(page.getByTestId("payee-notice")).toHaveCount(0);
  });

  test("the drawer lists the payee's items with links into /items", async ({ page }) => {
    await page.goto("/payees");
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
        // The dialog and drawer fade and zoom in: let them finish so axe measures the final colors, not a mid-fade.
        await finishAnimations(page);
        const res = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
        return res.violations
          .filter((v) => v.impact === "serious" || v.impact === "critical")
          .map((v) => `${label}: [${v.impact}] ${v.id} ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" ; ")}`);
      };
      await page.goto("/payees");
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
      const errors = trackConsoleErrors(page);
      await page.goto("/payees");
      await expect(page.getByTestId("review-queue")).toBeVisible();
      // Screenshotting before hydration makes Playwright's caret-hiding style mismatch the server HTML (a dev-overlay "Issue").
      await settle(page);
      await page.screenshot({ path: `${SHOTS_DIR}/payees-${width}.png`, fullPage: true });
      const dialog = await openFirstMergeReview(page);
      await expect(dialog.getByTestId("payee-diff")).toBeVisible();
      await settle(page);
      await page.screenshot({ path: `${SHOTS_DIR}/payees-${width}-merge-dialog.png` });
      expect(errors).toEqual([]);
    });
  }
});
