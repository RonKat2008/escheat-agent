import { expect, type Page } from "playwright/test";

/**
 * V4 dashboard: the money flow, status, audit interest and the featured check are folded under "More detail"
 * (`dash-more`, a closed <details>). Specs that look at them open it first. Idempotent.
 */
export async function openDashboardDetail(page: Page): Promise<void> {
  const more = page.getByTestId("dash-more");
  await expect(more).toBeAttached({ timeout: 60_000 });
  if ((await more.getAttribute("open")) === null) await more.locator("summary").click();
  await expect(more).toHaveAttribute("open", "");
}
