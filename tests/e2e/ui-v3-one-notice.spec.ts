/**
 * One notice per owner (dogfood round 3, opportunity #4; R2-04, R3-13).
 *  - merge the Bayline duplicates through the payee-merge UI, then draft a letter for each Bayline check
 *  - Compose all combines them: ONE Bayline letter listing #10482 and #10537, "2 checks · $6,126.71"
 *  - the row shows the letter → email → call sequence with the product cadence (Day 14, Day 21)
 *  - approve works on the combined letter; recomposing it (an edit) voids the approval
 *  - axe (legacy mode) clean for serious/critical, no overflow at 375/1024/1440; shots .data/shots/one-notice-{1440,375}.png
 * Runs serially on the ui server (fresh SYNTHETIC seed per run). Approvals are recorded; nothing is sent.
 */
import { mkdirSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "playwright/test";

const DISCLAIMER = "Prototype. Not legal advice. Confirm filings with a qualified professional.";
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const SHOTS = ".data/shots";
const WIDTHS = [375, 1024, 1440] as const;
/** #10482 $2,340.00 + #10537 $3,786.71, both CA, from the SYNTHETIC seed. */
const SUMMARY = "2 checks · $6,126.71";

test.describe.configure({ mode: "serial" });
test.beforeAll(() => mkdirSync(SHOTS, { recursive: true }));

async function axeBlocking(page: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page }).setLegacyMode(true).withTags(WCAG_TAGS).analyze();
  return violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
}

async function noOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "horizontal page overflow").toBeLessThanOrEqual(0);
}

async function settle(page: Page) {
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));
}

async function openApprovals(page: Page, query = "") {
  await page.goto(`/approvals${query}`);
  await expect(page.locator("[data-key]").first()).toBeVisible({ timeout: 30_000 });
  await page.waitForLoadState("networkidle").catch(() => undefined);
}

const baylineRows = (page: Page) => page.locator("[data-key^='o:']").filter({ hasText: "Bayline Electric" });

let noticeKey: string | null = null;

test("merge Bayline's duplicates, draft both checks, Compose all makes ONE letter listing both", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 900 });

  // 1. Merge the pair through the payee-merge UI (same confirm flow as ui-activity-r2 / ui-payees).
  await page.goto("/payees");
  const pair = page.getByTestId("review-pair").filter({ hasText: "BAYLINE ELEC" }).first();
  const dialog = page.getByTestId("payee-change-dialog");
  await expect(async () => {
    await pair.getByRole("button", { name: /Review merge/ }).click();
    await expect(dialog).toBeVisible({ timeout: 1_500 });
  }).toPass({ timeout: 30_000 });
  await expect(dialog.getByTestId("merge-direction")).toContainText("Keep Bayline Electric as the canonical name");
  await dialog.getByPlaceholder("Your name").fill("Dana One-Notice");
  await dialog.getByTestId("payee-change-confirm").click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });

  // 2. Draft a letter for each Bayline check from the item drawer (each starts as its own letter).
  const drawer = page.getByTestId("item-drawer");
  for (const check of ["10482", "10537"]) {
    await page.goto(`/items?item=${check}`);
    await expect(drawer).toBeVisible({ timeout: 30_000 });
    const draft = drawer.getByTestId("drawer-draft");
    if (await draft.isVisible({ timeout: 15_000 }).catch(() => false)) {
      const done = page.waitForResponse((r) => r.url().endsWith("/api/outreach/draft") && r.request().method() === "POST", { timeout: 90_000 });
      await draft.click();
      expect((await done).status()).toBe(201);
      await expect(drawer.getByRole("link", { name: "Review in approvals" })).toBeVisible({ timeout: 30_000 });
    }
  }

  // Two open Bayline letters: neither can be approved until they are combined.
  await openApprovals(page);
  await expect(baylineRows(page)).toHaveCount(2);
  await expect(baylineRows(page).first().getByTestId("blocked-reason")).toContainText(/another open letter in CA/i);

  // 3. Compose all combines them.
  const composeAll = page.getByTestId("compose-all");
  await expect(composeAll).toBeVisible();
  const composed = page.waitForResponse((r) => r.url().endsWith("/api/outreach/compose-all") && r.request().method() === "POST", { timeout: 120_000 });
  await composeAll.click();
  const res = await composed;
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { results: { status: string; itemCount?: number; outreachId: string; combined?: string[] }[]; summary: { combined: number } };
  const notice = body.results.find((r) => r.status === "composed" && r.itemCount === 2);
  expect(notice, "one composed notice lists both checks").toBeDefined();
  expect(notice!.combined).toHaveLength(1);
  expect(body.summary.combined).toBeGreaterThanOrEqual(1);
  await expect(page.getByText(/^Composed \d+: \d+ ready, \d+ blocked$/)).toBeVisible({ timeout: 60_000 });
  noticeKey = `o:${notice!.outreachId}`;

  // One Bayline row, showing the total and the sequence.
  await expect(baylineRows(page)).toHaveCount(1, { timeout: 30_000 });
  const row = baylineRows(page).first();
  await expect(row.getByTestId("row-notice-summary")).toContainText(SUMMARY);
  await expect(row.getByTestId("row-sequence")).toContainText(/Letter.*Email.*Day 14.*Call.*Day 21/);

  // The detail lists both checks with the total; the letter itself lists both too.
  await row.click();
  const detail = page.getByTestId("approval-detail");
  const items = detail.getByTestId("notice-items");
  await expect(items).toContainText(SUMMARY);
  await expect(items.getByTestId("notice-item")).toHaveCount(2);
  await expect(items).toContainText("#10482");
  await expect(items).toContainText("#10537");
  await expect(items.getByTestId("notice-total")).toHaveText("$6,126.71");
  await expect(detail.getByTestId("sequence-cadence")).toContainText("not a legal deadline");
  const html = await (await page.request.get(`/api/outreach/${notice!.outreachId}/preview`)).text();
  expect(html).toContain("#10482");
  expect(html).toContain("#10537");
  expect(html).toContain("$6,126.71");
  expect(html.match(/data-statutory="true"/g) ?? [], "one statutory block, from the CA rule file").toHaveLength(1);
  await expect(page.getByText(DISCLAIMER)).toBeVisible();
  await expect(detail.getByText("UNVERIFIED").first()).toBeVisible();
});

test("approve works on the combined letter, and recomposing it voids the approval", async ({ page }) => {
  test.setTimeout(180_000);
  expect(noticeKey).toBeTruthy();
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApprovals(page, `?sel=${noticeKey}`);
  const detail = page.getByTestId("approval-detail");
  await expect(detail.getByTestId("notice-items")).toBeVisible({ timeout: 30_000 });
  const approve = detail.getByTestId("approve-btn");
  await expect(approve).toBeEnabled({ timeout: 30_000 });
  const approved = page.waitForResponse((r) => /\/api\/outreach\/[^/]+\/approve$/.test(r.url()) && r.request().method() === "POST");
  await approve.click();
  expect((await approved).ok()).toBe(true);
  await expect(detail.getByTestId("flip-stamp")).toHaveAttribute("data-flipped", "true");
  await expect(detail.getByText(/Approved by/)).toBeVisible({ timeout: 20_000 });
  await expect(detail.getByTestId("send-btn")).toBeEnabled();

  // Edit = recompose the notice (the same draft call the Recompose button makes). The approval is voided.
  const outreachId = noticeKey!.slice(2);
  const itemHref = await detail.getByRole("link", { name: /Open item/ }).getAttribute("href");
  const leadItem = new URL(itemHref!, "http://x").searchParams.get("item");
  const redraft = await page.request.post("/api/outreach/draft", { data: { staleItemId: leadItem, channel: "letter" } });
  expect(redraft.status()).toBe(201);
  const { outreachId: freshId } = (await redraft.json()) as { outreachId: string };
  expect(freshId).not.toBe(outreachId);

  // The old approval cannot send anything: the approved draft was superseded.
  const send = await page.request.post(`/api/outreach/${outreachId}/send`, { data: {} });
  expect(send.status()).toBeGreaterThanOrEqual(400);

  await openApprovals(page, `?sel=o:${freshId}`);
  await expect(baylineRows(page)).toHaveCount(1);
  const fresh = page.getByTestId("approval-detail");
  await expect(fresh.getByTestId("notice-items").getByTestId("notice-item")).toHaveCount(2);
  await expect(fresh.getByTestId("flip-stamp")).toHaveAttribute("data-flipped", "false");
  await expect(fresh.getByTestId("approve-btn")).toHaveText(/^Approve$/);
  await expect(fresh.getByTestId("send-btn")).toBeDisabled();
});

test("bulk approve accepts the combined letter", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApprovals(page);
  const tab = page.getByTestId("queue-tab-ready");
  await tab.click();
  const row = baylineRows(page).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  const box = row.locator("xpath=ancestor::li[1]").getByTestId("approval-select");
  await box.check();
  await expect(page.getByTestId("bulk-bar")).toBeVisible();
  await page.getByTestId("bulk-approve").click();
  const dialog = page.getByTestId("bulk-approve-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("bulk-payload")).toHaveCount(1);
  await expect(dialog.getByTestId("bulk-payload")).toContainText("Bayline Electric");
  const confirm = dialog.getByTestId("bulk-confirm");
  const done = page.waitForResponse((r) => r.url().endsWith("/api/outreach/bulk-approve") && r.request().method() === "POST", { timeout: 60_000 });
  await confirm.click();
  const res = await done;
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { summary: { approved: number; failed: number } };
  expect(body.summary).toMatchObject({ approved: 1, failed: 0 });
});

test("one notice at 375 / 1024 / 1440: no overflow, axe clean, screenshots", async ({ page }) => {
  test.setTimeout(180_000);
  expect(noticeKey).toBeTruthy();
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
    await openApprovals(page);
    const row = baylineRows(page).first();
    await expect(row).toBeVisible();
    await row.click();
    const detail = page.getByTestId("approval-detail");
    await expect(detail.getByTestId("notice-items")).toBeVisible({ timeout: 30_000 });
    await settle(page);
    await noOverflow(page);
    expect(await axeBlocking(page)).toEqual([]);
    if (width !== 1024) {
      await detail.getByTestId("notice-items").scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${SHOTS}/one-notice-${width}.png` });
    }
  }
});
