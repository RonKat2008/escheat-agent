import { expect, type Locator, type Page } from "playwright/test";

/**
 * V4 has no sidebar: every page is reachable from the menu sheet ("Open navigation") and the pill nav's dropdowns.
 * Opens the menu sheet (retrying the click until hydration wires it) and returns the page's link inside it.
 * Close it again with `closeMenuSheet`.
 */
export async function menuSheetLink(page: Page, name: string): Promise<Locator> {
  const sheet = page.getByTestId("menu-sheet");
  await expect(async () => {
    if (!(await sheet.isVisible())) await page.getByRole("button", { name: /^Open navigation/ }).click();
    await expect(sheet).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  return sheet.getByRole("link", { name, exact: true }).first();
}

export async function closeMenuSheet(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("menu-sheet")).toBeHidden();
}
