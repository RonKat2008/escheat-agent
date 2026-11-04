/**
 * Round 7, approvals + auth slice:
 *  - R6-10 the approver is shown as a name only ("gate disabled" is never printed)
 *  - R6-20a Discard draft: confirm dialog, reason + approver required, the draft ends cancelled
 *  - R6-20b a not-yet-approved letter's flip-stamp does not expose "Approved" text
 *  - axe (legacy mode) and no horizontal overflow at 375/1024/1440; screenshots in .data/shots/r7-approvals/
 */
import { mkdirSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "playwright/test";
import { finishAnimations } from "./animations";
import { fillApprover } from "./approver";

const SHOTS = ".data/shots/r7-approvals";
const WIDTHS = [375, 1024, 1440] as const;

test.describe.configure({ mode: "serial" });
test.beforeAll(() => mkdirSync(SHOTS, { recursive: true }));

async function openFirstDraft(page: Page) {
  await page.goto("/approvals");
  const rows = page.locator("[data-key^='o:']");
  await expect(rows.first()).toBeVisible({ timeout: 30_000 });
  await rows.first().click();
  await expect(page.getByTestId("approve-bar")).toBeVisible();
  await finishAnimations(page);
}

test("a draft that is not approved exposes no 'Approved' text and no gate-disabled label", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openFirstDraft(page);
  const stamp = page.getByTestId("flip-stamp");
  await expect(stamp).toHaveAttribute("data-flipped", "false");
  expect(await stamp.evaluate((el) => (el as HTMLElement).innerText)).not.toMatch(/approved/i);
  await expect(page.locator("main")).not.toContainText("gate disabled");
});

test("Discard draft: needs a name and a reason, then the draft is cancelled", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openFirstDraft(page);
  await page.getByTestId("discard-btn").click();
  const dialog = page.getByTestId("discard-dialog");
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId("discard-confirm")).toBeDisabled();
  await page.screenshot({ path: `${SHOTS}/discard-dialog-1440.png` });
  await dialog.getByRole("button", { name: "Keep draft" }).click();
  await expect(dialog).toHaveCount(0);

  await fillApprover(page);
  await page.getByTestId("discard-btn").click();
  await page.getByTestId("discard-reason").fill("Not needed for this cycle");
  await expect(page.getByTestId("discard-confirm")).toBeEnabled();
  await page.getByTestId("discard-confirm").click();
  await expect(page.getByText("This draft was cancelled.")).toBeVisible({ timeout: 30_000 });
});

for (const width of WIDTHS) {
  test(`approvals desk at ${width}px: no overflow, no serious axe violations`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openFirstDraft(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const { violations } = await new AxeBuilder({ page }).setLegacyMode(true).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
    await page.screenshot({ path: `${SHOTS}/approvals-${width}.png` });
  });
}
