/**
 * Bulk workflows (ui group): multi-select on /items with a sticky action bar and bulk draft, and the bulk-approve
 * confirm dialog on /approvals. The tests run in order: the first one creates letter drafts, the second approves
 * from them (it only opens the dialog and cancels, so no approval rows are written by this spec).
 * Drafts are the only state created; the ui server re-seeds its database on every run.
 */
import { mkdirSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "playwright/test";

const DISCLAIMER = "Prototype. Not legal advice. Confirm filings with a qualified professional.";
const SHOTS = ".data/shots";
const parseUsd = (t: string) => Math.round(Number(t.replace(/[^0-9.]/g, "")) * 100);
const fmtUsd = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function noOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

async function expectAxeClean(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const blocking = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(blocking.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

/** Waits until every running animation/transition on the page has finished (enter animations, fades). */
async function settleAnimations(page: Page) {
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));
}

/** The dialog must be fully opaque, topmost at its centre (nothing, e.g. the letter iframe, paints above it) and dim the page. */
async function expectDialogTopmostAndOpaque(page: Page, testId: string) {
  const dialog = page.getByTestId(testId);
  await expect(dialog).toBeVisible();
  await settleAnimations(page);
  const info = await dialog.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    const bg = getComputedStyle(el).backgroundColor;
    const alpha = bg.startsWith("rgba") ? Number(bg.replace(/^rgba\(|\)$/g, "").split(",")[3]) : 1;
    // Also probe the four inner corners, where a see-through surface or an iframe would show.
    const corners = [
      [r.left + 8, r.top + 8],
      [r.right - 8, r.top + 8],
      [r.left + 8, r.bottom - 8],
      [r.right - 8, r.bottom - 8],
    ].map(([x, y]) => el.contains(document.elementFromPoint(x!, y!)));
    const overlay = document.querySelector("[data-slot='dialog-overlay']");
    return {
      hitInside: hit !== null && el.contains(hit),
      corners,
      bg,
      alpha,
      opacity: Number(getComputedStyle(el).opacity),
      overlayAlpha: overlay ? Number(getComputedStyle(overlay).backgroundColor.replace(/^rgba?\(|\)$/g, "").split(/[ ,/]+/).filter(Boolean)[3] ?? 1) : 0,
    };
  });
  expect(info.hitInside).toBe(true);
  expect(info.corners).toEqual([true, true, true, true]);
  expect(info.alpha).toBe(1);
  expect(info.bg).not.toBe("rgba(0, 0, 0, 0)");
  expect(info.opacity).toBe(1);
  expect(info.overlayAlpha).toBeGreaterThan(0.3); // dimmed backdrop
}

/** The bulk bar is a footer of the list pane: it never leaves the viewport and, on a tall page, sits on its bottom edge. */
async function expectBarDocked(page: Page) {
  const gap = await page.getByTestId("bulk-bar").evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { bottomGap: window.innerHeight - r.bottom, tall: document.documentElement.scrollHeight > window.innerHeight + 4 || window.innerWidth < 1024 };
  });
  expect(gap.bottomGap).toBeGreaterThanOrEqual(-1);
  if (gap.tall) expect(gap.bottomGap).toBeLessThanOrEqual(1);
}

/** Selects the first n rows' checkboxes and waits for hydration (retrying the first click). */
async function selectFirst(page: Page, n: number) {
  const boxes = page.getByTestId("row-select");
  await expect(async () => {
    await boxes.first().click();
    await expect(page.getByTestId("bulk-count")).toHaveText("1", { timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  for (let i = 1; i < n; i++) await boxes.nth(i).click();
  await expect(page.getByTestId("bulk-count")).toHaveText(String(n));
}

async function rowAmountCents(page: Page, index: number) {
  return parseUsd(await page.locator("tbody tr[data-row-id]").nth(index).locator("td.text-right").innerText());
}

test.describe.configure({ mode: "serial" });
test.beforeAll(() => mkdirSync(SHOTS, { recursive: true }));

test.describe("items: multi-select and bulk draft", () => {
  test("select rows: bar count and total are exact; shift-click selects a range; select-all; clear", async ({ page }) => {
    await page.goto("/items?state=CA");
    await expect(page.locator("tbody tr[data-row-id]").first()).toBeVisible();
    await expect(page.getByTestId("bulk-bar")).toBeHidden();

    await selectFirst(page, 3);
    const expected = (await rowAmountCents(page, 0)) + (await rowAmountCents(page, 1)) + (await rowAmountCents(page, 2));
    await expect(page.getByTestId("bulk-total")).toHaveText(fmtUsd(expected));
    await expect(page.getByRole("button", { name: "Draft outreach for 3 items" })).toBeVisible();
    await expect(page.getByText(DISCLAIMER)).toBeVisible();

    // shift-click extends to a range from the last-clicked row
    const boxes = page.getByTestId("row-select");
    await boxes.nth(5).click({ modifiers: ["Shift"] });
    await expect(page.getByTestId("bulk-count")).toHaveText("6");

    // select-all-filtered
    await page.getByTestId("select-all").click();
    const shown = await page.locator("tbody tr[data-row-id]").count();
    await expect(page.getByTestId("bulk-count")).toHaveText(String(shown));
    await page.getByTestId("bulk-clear").click();
    await expect(page.getByTestId("bulk-bar")).toBeHidden();
  });

  test("keyboard: j moves to a row and x toggles it; j/k/Enter still work", async ({ page }) => {
    await page.goto("/items?state=CA");
    await expect(page.locator("tbody tr[data-row-id]").first()).toBeVisible();
    // Hydration gate: the select-all checkbox only toggles once handlers are attached.
    await expect(async () => {
      await page.getByTestId("select-all").click();
      await expect(page.getByTestId("bulk-bar")).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
    await page.getByTestId("bulk-clear").click();
    await expect(page.getByTestId("bulk-bar")).toBeHidden();

    await page.locator("body").click({ position: { x: 1, y: 1 } });
    await page.keyboard.press("j");
    await page.keyboard.press("j");
    const second = page.locator("tbody tr[data-row-id]").nth(1);
    await expect(second).toHaveAttribute("data-selected", "true");
    await page.keyboard.press("x");
    await expect(second).toHaveAttribute("data-checked", "true");
    await expect(page.getByTestId("bulk-count")).toHaveText("1");
    await page.keyboard.press("x");
    await expect(page.getByTestId("bulk-bar")).toBeHidden();

    await page.keyboard.press("k");
    await expect(page.locator("tbody tr[data-row-id]").first()).toHaveAttribute("data-selected", "true");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/item=/);
  });

  test("bulk draft reports drafted and skipped items; nothing is sent", async ({ page }) => {
    await page.goto("/items?state=CA");
    await expect(page.locator("tbody tr[data-row-id]").first()).toBeVisible();
    await selectFirst(page, 5);
    await page.getByRole("button", { name: "Draft outreach for 5 items" }).click();
    // Slice 3: a dry-run preview comes first; confirming it drafts.
    const confirm = page.getByTestId("bulk-preview-confirm");
    await expect(confirm).toBeEnabled({ timeout: 30_000 });
    await confirm.click();
    const results = page.getByTestId("bulk-draft-results");
    await expect(results).toBeVisible({ timeout: 30_000 });
    const title = (await results.getByRole("heading").first().innerText()).match(/(\d+) drafted, (\d+) skipped/);
    expect(title).not.toBeNull();
    expect(Number(title![1]) + Number(title![2])).toBe(5);
    await expect(results).toContainText("Nothing has been sent");
    await expectDialogTopmostAndOpaque(page, "bulk-draft-results");
    await expectAxeClean(page);
    await page.keyboard.press("Escape");
    await expect(results).toBeHidden();
  });

  test("selection bar is clean at 375 and 1440 (screenshots, no overflow, axe)", async ({ page }) => {
    for (const width of [375, 1440]) {
      await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
      await page.goto("/items");
      await expect(page.locator("tbody tr[data-row-id]").first()).toBeVisible();
      await selectFirst(page, 3);
      await noOverflow(page);
      await expectAxeClean(page);
      await settleAnimations(page);
      await page.screenshot({ path: `${SHOTS}/bulk-items-bar-${width}.png` });
    }
  });
});

test.describe("approvals: bulk approve confirm dialog", () => {
  test("dialog lists every payload; cancel records nothing", async ({ page }) => {
    const posts: string[] = [];
    page.on("request", (r) => {
      if (r.method() === "POST" && r.url().includes("/api/outreach/")) posts.push(r.url());
    });
    await page.goto("/approvals");
    const boxes = page.getByTestId("approval-select");
    await expect(boxes.first()).toBeVisible();
    // Bulk draft now skips items that can never be approved, and new drafts start uncomposed: compose them first
    // (Compose all records no approval and sends nothing) so the ready letters can be selected.
    const composeAll = page.getByTestId("compose-all");
    if (await composeAll.count()) {
      const composed = page.waitForResponse((r) => r.url().endsWith("/api/outreach/compose-all"), { timeout: 120_000 });
      await composeAll.click();
      expect((await composed).status()).toBe(200);
      await expect(composeAll).toBeHidden({ timeout: 60_000 });
    }
    const enabled = page.locator("[data-testid='approval-select']:not([disabled])");
    // The seed now yields exactly one approvable letter after Compose all (bulk draft skips the rest), so select
    // every ready letter, up to two, and check the dialog lists each one.
    const n = Math.min(await enabled.count(), 2);
    expect(n).toBeGreaterThanOrEqual(1);
    const queueBefore = await page.getByTestId("queue-count").innerText();

    await expect(async () => {
      await enabled.first().click();
      await expect(page.getByTestId("bulk-count")).toHaveText("1", { timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
    if (n > 1) await enabled.nth(1).click();
    await expect(page.getByTestId("bulk-count")).toHaveText(String(n));
    await expect(page.getByTestId("bulk-total")).toContainText("$");
    await expectBarDocked(page);
    await page.getByTestId("bulk-approve").click();

    const dialog = page.getByTestId("bulk-approve-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading")).toContainText(`Approve ${n}`);
    const payloads = dialog.getByTestId("bulk-payload");
    await expect(payloads).toHaveCount(n);
    for (const p of await payloads.all()) {
      await expect(p).toContainText("Mail due-diligence letter");
      await expect(p).toContainText(/\$[\d,]+\.\d{2}/);
      await expect(p).toContainText("To ");
    }
    await expect(dialog.getByLabel("Approving as")).toBeVisible();
    await expectDialogTopmostAndOpaque(page, "bulk-approve-dialog");
    await expect(page.getByText(DISCLAIMER)).toBeVisible();
    await expectAxeClean(page);
    await page.screenshot({ path: `${SHOTS}/bulk-approve-dialog-${page.viewportSize()!.width}.png` });

    await page.getByTestId("bulk-cancel").click();
    await expect(dialog).toBeHidden();
    // selection is kept, the queue is untouched, and no approval request was made
    await expect(page.getByTestId("bulk-count")).toHaveText(String(n));
    await expect(page.getByTestId("queue-count")).toHaveText(queueBefore);
    expect(posts.filter((u) => u.includes("bulk-approve") || u.includes("/approve"))).toEqual([]);
  });

  test("dialog and list are clean at 375 and 1440", async ({ page }) => {
    for (const width of [375, 1440]) {
      await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
      await page.goto("/approvals");
      const enabled = page.locator("[data-testid='approval-select']:not([disabled])");
      await expect(enabled.first()).toBeVisible();
      await expect(async () => {
        await enabled.first().click();
        await expect(page.getByTestId("bulk-count")).toHaveText("1", { timeout: 1_000 });
      }).toPass({ timeout: 15_000 });
      await noOverflow(page);
      await expectBarDocked(page);
      await page.screenshot({ path: `${SHOTS}/bulk-approvals-bar-${width}.png` });
      await page.getByTestId("bulk-approve").click();
      await expect(page.getByTestId("bulk-approve-dialog")).toBeVisible();
      await noOverflow(page);
      await expectDialogTopmostAndOpaque(page, "bulk-approve-dialog");
      await page.screenshot({ path: `${SHOTS}/bulk-approve-dialog-${width}.png` });
      await expectAxeClean(page);
      await page.getByTestId("bulk-cancel").click();
    }
  });
});
