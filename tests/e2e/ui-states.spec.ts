import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "playwright/test";

/**
 * Two states that were never visually checked: the /login wrong-passcode error and the CSV upload dropzone
 * (idle, drag-over, invalid file, server parse error, mapping). Runs in the "ui" group, whose server is
 * passcode-gated (E2E_UI_PASSCODE) so the error is reachable. Deterministic: waits are on elements, never sleeps.
 */
const WIDTHS = [375, 1024, 1440] as const;
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const BLUE_400 = "rgb(110, 155, 255)";
const PINK_400 = "rgb(255, 127, 192)";

test.use({ reducedMotion: "reduce" });

/** The page's own alert, not Next's always-present (empty) route announcer. */
const appAlert = (page: Page) => page.locator("[role='alert']:not(#__next-route-announcer__)");

async function expectNoOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
}
async function expectNoBlockingAxe(page: Page, label: string) {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  const blocking = violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.help}`);
  expect(blocking, `${label}: serious/critical axe violations`).toEqual([]);
}

test.describe("login error state", () => {
  // Cleared session so the gate shows the form; one wrong attempt only (the limiter allows a burst of 5).
  test.use({ storageState: { cookies: [], origins: [] } });

  test("wrong passcode is announced, refocuses the field, and fits at 375/1024/1440", async ({ page }) => {
    await page.goto("/login");
    // The action form must be hydrated before submit, or the result of the server action is dropped on first compile.
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
    const input = page.getByLabel("Passcode");
    await input.fill("definitely-wrong");
    await page.getByRole("button", { name: "Enter" }).click();

    const alert = appAlert(page);
    await expect(alert).toHaveText("Incorrect passcode.");
    await expect(alert).toHaveAttribute("id", "passcode-error");
    await expect(input).toHaveAttribute("aria-invalid", "true");
    await expect(input).toHaveAttribute("aria-describedby", "passcode-error");
    await expect(input).toBeFocused();
    await expect(input).toHaveValue("");
    await expect(page).toHaveURL(/\/login/);

    // Palette only: pink error text, blue focus outline.
    await expect(alert).toHaveCSS("color", PINK_400);
    await expect(input).toHaveCSS("outline-color", BLUE_400);

    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
      await expect(alert).toBeVisible();
      await expectNoOverflow(page);
      await expectNoBlockingAxe(page, `login error @${width}`);
    }
  });
});

test.describe("CSV dropzone", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/settings/integrations");
    await expect(page.getByRole("button", { name: /Drop a CSV here/ })).toBeVisible();
  });

  test("idle: focusable with a blue ring, no overflow, axe clean at every width", async ({ page }) => {
    const zone = page.getByRole("button", { name: /Drop a CSV here/ });
    await zone.focus();
    await expect(zone).toHaveCSS("outline-color", BLUE_400);
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
      await expectNoOverflow(page);
      await expectNoBlockingAxe(page, `dropzone idle @${width}`);
    }
  });

  test("drag-over highlights in blue and clears on leave", async ({ page }) => {
    const zone = page.getByRole("button", { name: /Drop a CSV here/ });
    const idleBorder = await zone.evaluate((el) => getComputedStyle(el).borderTopColor);
    const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
    // Drag handlers attach on hydration, which can land after the first dispatch on a cold CI server: retry it.
    await expect(async () => {
      await zone.dispatchEvent("dragover", { dataTransfer });
      await expect(zone).toHaveCSS("border-top-color", BLUE_400, { timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
    await zone.dispatchEvent("dragleave", { dataTransfer });
    await expect(zone).toHaveCSS("border-top-color", idleBorder);
  });

  test("invalid file type is rejected with an announced error and the dropzone stays", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.locator("input[type=file]").setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: Buffer.from([137, 80, 78, 71]) });
    const alert = appAlert(page);
    await expect(alert).toContainText('"photo.png" is not a CSV file');
    await expect(alert).toHaveCSS("color", PINK_400);
    await expect(page.getByRole("button", { name: /Drop a CSV here/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Suggest mapping" })).toHaveCount(0);
    await expectNoOverflow(page);
    await expectNoBlockingAxe(page, "dropzone invalid file");
  });

  test("empty file is rejected", async ({ page }) => {
    await page.locator("input[type=file]").setInputFiles({ name: "empty.csv", mimeType: "text/csv", buffer: Buffer.alloc(0) });
    await expect(appAlert(page)).toContainText('"empty.csv" is empty');
  });

  test("server parse error is announced and the file row fits at 375", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    // No readable header row: the real API answers 422 and stores nothing.
    await page.locator("input[type=file]").setInputFiles({ name: "a-rather-long-register-export-name-2026.csv", mimeType: "text/csv", buffer: Buffer.from("\n\n") });
    await expect(page.getByRole("button", { name: "Remove file" })).toBeVisible();
    await expectNoOverflow(page);
    await page.getByRole("button", { name: "Suggest mapping" }).click();
    await expect(appAlert(page)).toContainText("Could not read a header row");
    await expectNoOverflow(page);
    await expectNoBlockingAxe(page, "dropzone parse error");
  });

  test("mapping step shows column names, never the raw placeholder", async ({ page }) => {
    await page.locator("input[type=file]").setInputFiles({ name: "r.csv", mimeType: "text/csv", buffer: Buffer.from("zzz,qqq\n1,2\n") });
    await page.getByRole("button", { name: "Suggest mapping" }).click();
    await expect(page.getByText("Still needed:")).toBeVisible();
    await expect(page.getByText("__none__")).toHaveCount(0);
    await expect(page.getByRole("combobox", { name: "Payee name" })).toContainText("Not mapped");
    await expectNoBlockingAxe(page, "dropzone mapping");
  });
});
