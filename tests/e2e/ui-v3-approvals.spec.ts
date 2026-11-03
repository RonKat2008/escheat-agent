/**
 * DESIGN-V3 slice 4: the approvals desk and the owner pages.
 *  - pipeline diagram (three lanes, one YOU gate equal to the sidebar badge)
 *  - Compose all, the Ready to approve tab, inline block reasons (R2-04)
 *  - approve plays the flip-stamp; the toast never covers Send and goes away by itself (R3-02)
 *  - letter/email/call drafts for one owner are one row with a channel sequence (R3-13)
 *  - the email recipient is not prefilled and the allowlist block still works (R3-16)
 *  - no developer/config text in the desk (R3-14)
 *  - owner page renders (owner rail, three answers, one disclaimer); a bad token is a 404
 *  - axe (legacy mode) and no horizontal overflow at 375/1024/1440; screenshots in .data/shots/v3-approvals-*.png, v3-owner-*.png
 * Runs serially on the ui server (fresh seed per run). Approvals are recorded; nothing is sent.
 */
import { mkdirSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "playwright/test";
import { BLOCKED_RECIPIENT, E2E_SECRETS } from "./env";

const DISCLAIMER = "Prototype. Not legal advice. Confirm filings with a qualified professional.";
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const SHOTS = ".data/shots";
const WIDTHS = [375, 1024, 1440] as const;
const CONFIG_TEXT = /OWNER_LINK_SECRET|APP_BASE_URL|ALLOWED_TEST_RECIPIENTS|LOB_TEST_API_KEY|variables_source|rule TODO/;

test.describe.configure({ mode: "serial" });
test.beforeAll(() => mkdirSync(SHOTS, { recursive: true }));

async function axeBlocking(page: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page }).setLegacyMode(true).withTags(WCAG_TAGS).analyze();
  return violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
}

async function noOverflow(page: Page) {
  const { overflow, culprits } = await page.evaluate(() => {
    const wide = [...document.querySelectorAll<HTMLElement>("body *")]
      .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1)
      .filter((el) => {
        for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
          if (getComputedStyle(a).overflowX !== "visible") return false;
        }
        return true;
      })
      .slice(0, 3)
      .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)}`);
    return { overflow: document.documentElement.scrollWidth - window.innerWidth, culprits: wide.join(" | ") };
  });
  expect(overflow, `horizontal page overflow: ${culprits}`).toBeLessThanOrEqual(0);
}

async function settle(page: Page) {
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));
}

async function openApprovals(page: Page) {
  await page.goto("/approvals");
  await expect(page.locator("[data-key]").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("approvals-pipeline")).toBeVisible();
  await page.waitForLoadState("networkidle").catch(() => undefined);
}

const intersects = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

let ownerPath: string | null = null;

test("pipeline: three lanes and one YOU gate that matches the sidebar badge", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApprovals(page);
  const pipe = page.getByTestId("approvals-pipeline");
  for (const lane of ["Outreach", "Reports", "Recoveries"]) await expect(pipe.getByText(lane, { exact: true }).first()).toBeVisible();
  await expect(pipe.getByText("You", { exact: true })).toBeVisible();
  const gate = Number(await page.getByTestId("pipeline-gate-total").innerText());
  const badge = page.getByRole("navigation", { name: "Main navigation" }).first().getByRole("link", { name: /Approvals/ });
  const badgeCount = Number(/(\d+)/.exec((await badge.textContent()) ?? "")?.[1] ?? "0");
  expect(gate).toBe(badgeCount);
  expect(Number(await page.getByTestId("queue-count").innerText())).toBe(gate);
  await expect(page.getByText(DISCLAIMER)).toBeVisible();

  // An outreach node filters the list; pressing it again clears the filter.
  const draftNode = pipe.locator("[data-pipeline-node='outreach:draft']");
  await draftNode.click();
  await expect(draftNode).toHaveAttribute("aria-pressed", "true");
  await draftNode.click();
  await expect(draftNode).toHaveAttribute("aria-pressed", "false");
});

test("compose all composes the queue; blocked drafts say why inline, in plain language", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApprovals(page);
  const composeAll = page.getByTestId("compose-all");
  if (await composeAll.count()) {
    const done = page.waitForResponse((r) => r.url().endsWith("/api/outreach/compose-all") && r.request().method() === "POST", { timeout: 120_000 });
    await composeAll.click();
    expect((await done).status()).toBe(200);
    await expect(page.getByText(/^Composed \d+: \d+ ready, \d+ blocked$/)).toBeVisible({ timeout: 60_000 });
    await expect(composeAll).toBeHidden({ timeout: 60_000 });
  }
  const reasons = page.getByTestId("blocked-reason");
  await expect(reasons.first()).toBeVisible({ timeout: 30_000 });
  for (const t of await reasons.allInnerTexts()) {
    expect(t).toMatch(/^Blocked: /);
    expect(t).not.toMatch(CONFIG_TEXT);
  }
  await expect(page.locator("main")).not.toContainText(CONFIG_TEXT);
});

test("ready tab lists only approvable drafts; select ready fills the bulk bar", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApprovals(page);
  const tab = page.getByTestId("queue-tab-ready");
  await tab.click();
  await expect(tab).toHaveAttribute("aria-pressed", "true");
  const readyCount = Number((await tab.innerText()).match(/(\d+)\s*$/)?.[1] ?? "0");
  expect(readyCount, "compose all leaves at least one ready draft in the seed").toBeGreaterThanOrEqual(1);
  await expect(page.getByTestId("blocked-reason")).toHaveCount(0);
  await page.getByTestId("select-ready").click();
  await expect(page.getByTestId("bulk-bar")).toBeVisible();
  expect(Number(await page.getByTestId("bulk-count").innerText())).toBeGreaterThanOrEqual(1);
  await page.getByTestId("bulk-approve").click();
  const dialog = page.getByTestId("bulk-approve-dialog");
  await expect(dialog).toBeVisible();
  expect(await axeBlocking(page)).toEqual([]);
  await dialog.getByTestId("bulk-cancel").click();
  await expect(dialog).toBeHidden();
  await page.getByRole("button", { name: "Clear" }).first().click();
  await page.screenshot({ path: `${SHOTS}/v3-approvals-ready-1440.png` });
});

test("keyboard: j/k move between owners and focus the detail", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApprovals(page);
  const rows = page.locator("[data-key]");
  expect(await rows.count(), "the seeded queue has several owners").toBeGreaterThan(1);
  await rows.first().click();
  await page.locator("body").click({ position: { x: 1, y: 1 } });
  await page.keyboard.press("j");
  await expect(rows.nth(1)).toHaveAttribute("aria-current", "true");
  await expect(page.getByTestId("approval-detail").locator("[data-detail-heading]")).toBeFocused();
  await page.keyboard.press("k");
  await expect(rows.first()).toHaveAttribute("aria-current", "true");
});

test("approve (a key) plays the flip-stamp; the toast never covers Send and dismisses itself", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApprovals(page);
  await page.getByTestId("queue-tab-ready").click();
  const row = page.locator("[data-key^='o:']").first();
  const id = (await row.getAttribute("data-key"))?.slice(2);
  expect(id).toBeTruthy();
  // Open it from the All tab: once approved it leaves the Ready tab, which would unmount the detail mid-stamp.
  await page.goto(`/approvals?sel=o:${id}`);
  await expect(page.getByTestId("queue-tab-all")).toHaveAttribute("aria-pressed", "true");
  const detail = page.getByTestId("approval-detail");
  await expect(detail.getByTestId("letter-preview")).toBeVisible();
  await expect(detail.getByTestId("flip-stamp")).toHaveAttribute("data-flipped", "false");
  const approve = detail.getByTestId("approve-btn");
  await expect(approve).toBeEnabled();
  // Approve from the keyboard: "a" is the registry's approve shortcut (handledBy "page").
  await page.locator("body").click({ position: { x: 1, y: 1 } });
  await page.keyboard.press("a");
  await expect(detail.getByTestId("flip-stamp")).toHaveAttribute("data-flipped", "true");
  await expect(detail.getByTestId("approved-stamp")).toBeVisible();
  await expect(detail.getByText(/Approved by/)).toBeVisible({ timeout: 20_000 });

  const toast = page.locator("[data-sonner-toast]").filter({ hasText: "Approval recorded" });
  await expect(toast).toBeVisible();
  const send = detail.getByTestId("send-btn");
  await expect(send).toBeEnabled();
  const [tb, sb] = [await toast.boundingBox(), await send.boundingBox()];
  expect(tb && sb, "both boxes measured").toBeTruthy();
  expect(intersects(tb!, sb!), "the toast must not sit over Send").toBe(false);
  // Leave the pointer on Send (R3-02): the toast still goes away by itself.
  await send.hover();
  const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest("[data-testid='send-btn']") !== null, { x: sb!.x + sb!.width / 2, y: sb!.y + sb!.height / 2 });
  expect(hit, "Send is the topmost element at its centre").toBe(true);
  await expect(toast).toBeHidden({ timeout: 10_000 });
  await page.screenshot({ path: `${SHOTS}/v3-approvals-approved-1440.png` });

  // The approved letter carries the owner link used by the owner-page test.
  const html = await (await page.request.get(`/api/outreach/${id}/preview`)).text();
  ownerPath = /\/owner\/[A-Za-z0-9_.~%-]+/.exec(html)?.[0] ?? null;
});

test("one row per owner with a letter → email → call sequence; recipient is empty and the allowlist still blocks", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApprovals(page);
  const row = page.locator("[data-key^='o:']").first();
  await row.click();
  const detail = page.getByTestId("approval-detail");
  const group = await detail.getAttribute("data-group");
  const seq = detail.getByTestId("channel-sequence");
  await expect(seq).toBeVisible();

  const emailButton = seq.getByRole("button", { name: /^Email\b/ });
  if (!(await emailButton.count())) {
    const drafted = page.waitForResponse((r) => r.url().endsWith("/api/outreach/draft") && r.request().method() === "POST");
    await seq.getByRole("button", { name: "Draft email" }).click();
    expect((await drafted).status()).toBe(201);
  }
  await expect(emailButton).toHaveAttribute("aria-pressed", "true", { timeout: 20_000 });
  // Still ONE row for this owner, now showing both channels in order.
  const ownerRows = page.locator(`[data-group='${group}']`).filter({ has: page.getByTestId("row-sequence") });
  await expect(ownerRows).toHaveCount(1);
  await expect(ownerRows.getByTestId("row-sequence")).toContainText(/Letter.*Email/);

  const compose = detail.getByTestId("compose-btn");
  if (await compose.isVisible()) await compose.click();
  await expect(compose).toBeHidden({ timeout: 30_000 });

  const recipient = detail.getByTestId("recipient-input");
  await expect(recipient).toHaveValue("");
  await expect(recipient).toHaveAttribute("placeholder", /allowlisted/);
  await expect(page.locator("main")).not.toContainText(E2E_SECRETS.ALLOWED_TEST_RECIPIENTS);
  await recipient.fill(BLOCKED_RECIPIENT);
  await expect(detail.getByText(/not on the test allowlist/i).first()).toBeVisible();
  await expect(detail.getByTestId("approve-btn")).toBeDisabled();
  await recipient.fill(E2E_SECRETS.ALLOWED_TEST_RECIPIENTS);
  await expect(detail.getByText(/Recipient is on the test allowlist/i)).toBeVisible();
  await expect(page.locator("main")).not.toContainText(CONFIG_TEXT);
});

test("deep link ?kind=letter&state=CA opens the Letters tab scoped to one state", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/approvals?kind=letter&state=ca");
  await expect(page.getByTestId("queue-tab-letter")).toHaveAttribute("aria-pressed", "true");
  const chip = page.getByTestId("queue-state-filter");
  await expect(chip).toContainText("CA");
  const rows = page.locator("[data-key]");
  const n = await rows.count();
  for (let i = 0; i < n; i++) await expect(rows.nth(i)).toHaveAttribute("data-state", "CA");
  await chip.getByRole("button", { name: "Show all states" }).click();
  await expect(chip).toBeHidden();
  expect(await rows.count()).toBeGreaterThanOrEqual(n);
});

test("approvals at 375 / 1024 / 1440: no overflow, axe clean, screenshots", async ({ page }) => {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
    await openApprovals(page);
    await noOverflow(page);
    expect(await axeBlocking(page), `axe @${width}`).toEqual([]);
    await settle(page);
    if (width !== 1024) await page.screenshot({ path: `${SHOTS}/v3-approvals-${width}.png` });
    if (width === 375) {
      await page.locator("[data-key]").first().click();
      await expect(page.getByTestId("approval-detail")).toBeVisible();
      await noOverflow(page);
      await page.screenshot({ path: `${SHOTS}/v3-approvals-detail-375.png` });
    }
  }
});

test("owner page: amount, owner rail, three answers, one disclaimer; no overflow; axe", async ({ page }) => {
  expect(ownerPath, "owner link from the approved letter").toBeTruthy();
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
    const res = await page.goto(ownerPath!);
    expect(res?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/We are holding \$[\d,]+\.\d{2} for you/);
    await expect(page.getByText("Where this stands", { exact: true })).toBeVisible();
    for (const name of ["Confirm my address", "I already cashed it", "Send me the money"]) await expect(page.getByRole("button", { name })).toBeVisible();
    await expect(page.getByText(DISCLAIMER)).toHaveCount(1);
    await expect(page.getByTestId("loop-bar")).toHaveCount(0);
    await noOverflow(page);
    expect(await axeBlocking(page), `owner axe @${width}`).toEqual([]);
    await settle(page);
    if (width !== 1024) await page.screenshot({ path: `${SHOTS}/v3-owner-${width}.png`, fullPage: true });
  }
});

test("owner page: a bad token is a 404 with one disclaimer", async ({ page }) => {
  for (const width of [375, 1440] as const) {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
    const res = await page.goto("/owner/garbage-token");
    expect(res?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "We couldn't open this link" })).toBeVisible();
    await expect(page.getByText(DISCLAIMER)).toHaveCount(1);
    await noOverflow(page);
    expect(await axeBlocking(page)).toEqual([]);
    await page.screenshot({ path: `${SHOTS}/v3-owner-invalid-${width}.png` });
  }
});
