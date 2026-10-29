/**
 * UI lane B e2e: approvals gate, reports flow, eval honesty label.
 * Needs the seeded demo (pnpm seed:demo && pnpm pipeline:run) with the demo clock advanced so some
 * items are To Report and some letters are DD Due (see scripts/ui-b-prep.ts), and a server on E2E_BASE_URL.
 */
import { expect, test } from "playwright/test";

test.describe("approvals gate", () => {
  test("Send stays disabled until the draft is approved, then enables", async ({ page }) => {
    await page.goto("/approvals");
    await expect(page.getByRole("heading", { name: "Approvals", level: 1 })).toBeVisible();
    const rows = page.locator("[data-key^='o:']");
    await expect(rows.first()).toBeVisible();
    await rows.first().click();
    const detail = page.getByTestId("approval-detail");
    await expect(detail).toBeVisible();

    const compose = detail.getByTestId("compose-btn");
    if (await compose.isVisible().catch(() => false)) {
      await compose.click();
      await expect(compose).toBeHidden({ timeout: 20_000 });
    }
    const send = detail.getByTestId("send-btn");
    const approve = detail.getByTestId("approve-btn");
    await expect(send).toBeDisabled();
    await expect(approve).toBeVisible();

    if (await approve.isEnabled()) {
      await approve.click();
      await expect(detail.getByTestId("send-btn")).toBeEnabled({ timeout: 20_000 });
      await expect(detail.getByText(/Approved by/)).toBeVisible();
    } else {
      // Not approvable (e.g. required state language unknown): the reason is on screen and Send stays off.
      await expect(detail.getByText(/not verified|not ready|allowlist|No allowlisted/i).first()).toBeVisible();
      await expect(send).toBeDisabled();
    }
  });
});

test.describe("reports", () => {
  test("generate, validate, download the file and evidence pack", async ({ page, request }) => {
    await page.goto("/reports?state=CA");
    const detail = page.getByTestId("report-detail");
    await expect(detail).toBeVisible();
    const gen = page.getByTestId("generate-btn");
    test.skip(await gen.isDisabled(), "No CA items are in To Report in this database");
    await gen.click();
    await expect(page.getByTestId("validation-summary")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("validation-summary")).toContainText(/Passed with no errors|error/);

    // The page refreshes after generation; poll until the download link points at the new report.
    await expect
      .poll(async () => (await request.get((await page.getByTestId("download-file").getAttribute("href"))!)).status(), { timeout: 20_000 })
      .toBe(200);
    const file = await request.get((await page.getByTestId("download-file").getAttribute("href"))!);
    const text = await file.text();
    expect(text.length).toBeGreaterThan(600);
    expect(text.startsWith("1")).toBe(true); // HOLDER record

    const pdf = await request.get((await page.getByTestId("download-evidence").getAttribute("href"))!);
    expect(pdf.status()).toBe(200);
    expect((await pdf.body()).subarray(0, 4).toString()).toBe("%PDF");
  });

  test("the filing panel never offers to file an unapproved report", async ({ page }) => {
    await page.goto("/reports?state=CA");
    const panel = page.getByTestId("filing-panel");
    if (await panel.isVisible().catch(() => false)) {
      await expect(page.getByTestId("run-filing-btn")).toHaveCount(0);
    }
  });
});

test.describe("eval", () => {
  test("shows the classification method label", async ({ page }) => {
    await page.goto("/eval");
    await expect(page.getByTestId("eval-method")).toBeVisible();
    await expect(page.getByTestId("eval-method-label")).toHaveText(/Heuristic baseline|Model|Replay|Method not recorded/);
    await expect(page.getByText("pnpm eval").first()).toBeVisible();
  });
});

test.describe("no horizontal scroll", () => {
  for (const path of ["/approvals", "/reports", "/recoveries", "/runs", "/eval"]) {
    test(`${path} at 375px`, async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
});
