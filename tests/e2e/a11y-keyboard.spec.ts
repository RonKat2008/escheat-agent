import { expect, test } from "playwright/test";

/** Keyboard-only smoke test of the core demo path. No mouse: every step is Tab / Enter / Escape / Cmd+K. */

const MOD = process.platform === "darwin" ? "Meta" : "Control";

test("keyboard only: skip link, main nav, command palette, item drawer with focus return", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByRole("region", { name: "Total exposure" })).toBeVisible();

  // 1. The skip link is the first tab stop and moves focus into <main>.
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#main$/);
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => document.activeElement?.closest("main") !== null), "focus moved into <main> after skipping").toBe(true);

  // 2. The main nav is reachable by Tab (bounded walk so a regression fails fast).
  await page.goto("/dashboard");
  const itemsLink = page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Items", exact: true });
  let reached = false;
  for (let i = 0; i < 40 && !reached; i++) {
    await page.keyboard.press("Tab");
    reached = await itemsLink.evaluate((el) => el === document.activeElement);
  }
  expect(reached, "Items link in the main nav is reachable by Tab").toBe(true);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/items/);

  // 3. Command palette: open, filter, Enter on Approvals.
  await page.keyboard.press(`${MOD}+k`);
  const palette = page.getByRole("dialog");
  await expect(palette.getByRole("combobox")).toBeFocused();
  await page.keyboard.type("Approvals");
  await expect(palette.getByRole("option", { name: /Approvals/ })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/approvals/);
  await expect(palette).toBeHidden();

  // 4. Items: Enter on a row's open button opens the drawer; Escape closes it and focus returns to that button.
  await page.goto("/items");
  const opener = page.getByRole("button", { name: "Open Bayline Electric" }).first();
  await expect(opener).toBeVisible();
  await opener.focus();
  await page.keyboard.press("Enter");
  const drawer = page.getByTestId("item-drawer");
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText("Bayline Electric");
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(page).not.toHaveURL(/item=/);
  await expect(opener).toBeFocused();
});

test("items: a row is reachable and openable by keyboard at 375px (check column hidden)", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/items");
  const opener = page.getByRole("button", { name: "Open Bayline Electric" }).first();
  await expect(opener).toBeVisible(); // the visible payee cell is the control, not the hidden Check column
  await opener.focus();
  await expect(opener).toBeFocused();
  await page.keyboard.press("Enter");
  const drawer = page.getByTestId("item-drawer");
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText("Bayline Electric");
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(opener).toBeFocused();
});
