/**
 * Dogfood round 4, approvals slice:
 *  - R4-04 the pink "Awaiting you" gate column holds exactly what the header and the sidebar badge say waits on you
 *  - R4-19 the pipeline starts as a one-line strip, so the queue and the letter preview sit above the fold at 1440×900;
 *          at 375 the expanded diagram scrolls inside its own track (no page overflow, no clipping)
 *  - R4-24 the allowlist chip shows a masked address and the full address is nowhere in the page (HTML or RSC payload)
 *  - R4-10 an owner link from an unapproved / unsent letter does not work; the preview says so
 *  - #5   "Send all approved" sends through the gated path and labels offline honestly ("OFFLINE — not sent")
 *  - #4   (offline runs) owner reply → "Reissue …" task in Approvals and Needs you → Mark resolved → exposure drops
 * axe (legacy mode) and no horizontal overflow at 375/1024/1440. Screenshots: .data/shots/r4-approvals/ (or SHOTS_DIR).
 */
import { mkdirSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "playwright/test";
import { E2E_SECRETS } from "./env";
import { fillApprover } from "./approver";

const SHOTS = process.env.R4_SHOTS_DIR ?? ".data/shots/r4-approvals";
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const OWNER_TOKEN = /\/owner\/([A-Za-z0-9_.~%-]+)/;

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

async function openApprovals(page: Page, query = "") {
  await page.goto(`/approvals${query}`);
  await expect(page.locator("[data-key]").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("approvals-pipeline")).toBeVisible();
  await page.waitForLoadState("networkidle").catch(() => undefined);
}

const num = async (page: Page, testId: string) => Number((await page.getByTestId(testId).innerText()).replace(/[^\d]/g, ""));

async function badgeCount(page: Page): Promise<number> {
  const link = page.getByRole("navigation", { name: "Main navigation" }).first().getByRole("link", { name: /Approvals/ });
  return Number(/(\d+)/.exec((await link.textContent()) ?? "")?.[1] ?? "0");
}

const cents = (text: string) => Math.round(Number(text.replace(/[^\d.]/g, "")) * 100);

/** The exposure headline on the dashboard, in cents (reduced motion, so no count-up mid-read). */
async function dashboardTotal(page: Page): Promise<number> {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/dashboard");
  const hero = page.getByRole("region", { name: "Total exposure" });
  await expect(hero.getByTestId("exposure-meta")).toContainText("stale items", { timeout: 30_000 });
  const text = (await hero.innerText()).match(/\$[\d,]+\.\d{2}/)?.[0];
  expect(text, "dashboard total").toBeTruthy();
  return cents(text!);
}

test("R4-04 + R4-19: collapsed strip, gate column = header = badge, queue and preview above the fold at 1440", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApprovals(page);
  const pipe = page.getByTestId("approvals-pipeline");
  await expect(pipe).toHaveAttribute("data-expanded", "false");
  const gate = await num(page, "pipeline-gate-total");
  expect(gate).toBeGreaterThan(0);
  expect(await num(page, "queue-count")).toBe(gate);
  expect(await badgeCount(page)).toBe(gate);

  // Above the fold: the first queue row and the top of the letter preview.
  const firstRow = page.locator("[data-key]").first();
  await firstRow.click();
  const preview = page.getByTestId("approval-detail").getByTestId("letter-preview");
  if (await preview.count()) {
    const box = await preview.boundingBox();
    expect(box!.y, "preview starts above the fold").toBeLessThan(900 - 120);
  }
  expect((await firstRow.boundingBox())!.y).toBeLessThan(450);
  await page.screenshot({ path: `${SHOTS}/approvals-1440.png` });

  // Expanded, the pink column adds up to the header: lane gate nodes + owner replies + rule changes.
  await pipe.getByRole("button", { name: "Show diagram" }).click();
  await expect(pipe).toHaveAttribute("data-expanded", "true");
  const gateNodes = pipe.locator("[data-pipeline-node$=':awaiting_approval']");
  await expect(gateNodes).toHaveCount(3);
  let column = Number(await pipe.getAttribute("data-gate-extra"));
  for (const t of await gateNodes.allInnerTexts()) column += Number(/(\d+)/.exec(t)?.[1] ?? "0");
  expect(column).toBe(gate);
  await expect(pipe.locator("[data-pipeline-node='outreach:awaiting_approval']")).not.toContainText(/^Awaiting you\s*0$/);
  await page.screenshot({ path: `${SHOTS}/approvals-pipeline-open-1440.png` });
  await pipe.getByRole("button", { name: "Collapse" }).click();
  await expect(pipe).toHaveAttribute("data-expanded", "false");
});

test("R4-19 at 375 / 1024 / 1440: no page overflow, the open diagram scrolls in its own track, axe clean", async ({ page }) => {
  for (const width of [375, 1024, 1440] as const) {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
    await openApprovals(page);
    await noOverflow(page);
    expect(await axeBlocking(page), `axe collapsed @${width}`).toEqual([]);
    if (width === 375) {
      await page.screenshot({ path: `${SHOTS}/approvals-375.png` });
      const pipe = page.getByTestId("approvals-pipeline");
      await pipe.getByRole("button", { name: "Show diagram" }).click();
      const track = pipe.getByRole("region", { name: /Pipeline diagram/ });
      await expect(track).toBeVisible();
      const { scroll, client } = await track.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
      expect(scroll, "the diagram scrolls sideways inside its track").toBeGreaterThan(client);
      await noOverflow(page);
      expect(await axeBlocking(page), "axe expanded @375").toEqual([]);
      await page.screenshot({ path: `${SHOTS}/approvals-pipeline-open-375.png` });
      await pipe.getByRole("button", { name: "Collapse" }).click();
    }
  }
});

test("R4-24: the allowlist chip is masked and the full address never reaches the page", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApprovals(page, "?kind=letter");
  await page.locator("[data-key^='o:']").first().click();
  const detail = page.getByTestId("approval-detail");
  const seq = detail.getByTestId("channel-sequence");
  const emailButton = seq.getByRole("button", { name: /^Email\b/ });
  if (await emailButton.count()) await emailButton.click();
  else await seq.getByRole("button", { name: "Draft email" }).click();
  await expect(emailButton).toHaveAttribute("aria-pressed", "true", { timeout: 30_000 });
  const compose = detail.getByTestId("compose-btn");
  if (await compose.isVisible()) await compose.click();
  await expect(compose).toBeHidden({ timeout: 30_000 });

  const full = E2E_SECRETS.ALLOWED_TEST_RECIPIENTS;
  const chip = detail.getByTestId("allowlist-chip").first();
  await expect(chip).toHaveText(`${full[0]}•••${full.slice(full.indexOf("@"))}`);
  expect(await page.content(), "full allowlisted address in the HTML or RSC payload").not.toContain(full);

  await chip.click();
  await expect(chip).toHaveAttribute("aria-pressed", "true");
  await expect(detail.getByTestId("recipient-input")).toHaveValue(/•••@/);
  await expect(detail.getByText(/Recipient is on the test allowlist/i)).toBeVisible();
  // Typing the full address still works (the browser hashes it; the server decides).
  await detail.getByTestId("recipient-input").fill(full);
  await expect(detail.getByText(/Recipient is on the test allowlist/i)).toBeVisible();
  await expect(chip).toHaveAttribute("aria-pressed", "true");
  await detail.getByTestId("allowlist-chips").screenshot({ path: `${SHOTS}/allowlist-chip-masked.png` });
});

test("R4-10: a link from an unapproved letter is not live; the preview says so", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApprovals(page, "?kind=letter");
  const row = page.locator("[data-key^='o:']").first();
  await row.click();
  const detail = page.getByTestId("approval-detail");
  const compose = detail.getByTestId("compose-btn");
  if (await compose.isVisible()) await compose.click();
  await expect(compose).toBeHidden({ timeout: 30_000 });
  await expect(detail.getByTestId("send-btn")).toBeDisabled(); // not approved, not sent
  const id = (await row.getAttribute("data-key"))!.slice(2);
  const html = await (await page.request.get(`/api/outreach/${id}/preview`)).text();
  expect(html).toContain("not active until this notice is approved and sent");
  const token = OWNER_TOKEN.exec(html)?.[1];
  expect(token, "the composed letter prints an owner link").toBeTruthy();

  for (const width of [375, 1440] as const) {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
    await page.goto(`/owner/${token}`);
    await expect(page.getByRole("heading", { name: "This link isn't active yet" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Send me the money" })).toHaveCount(0);
    await noOverflow(page);
    expect(await axeBlocking(page), `owner not-live axe @${width}`).toEqual([]);
    await page.screenshot({ path: `${SHOTS}/owner-not-live-${width}.png` });
  }
});

test("#5 + #4: send all approved (honest offline label), then the owner loop closes on screen", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  // This spec approves nothing itself: every ui spec shares one seeded server, the queue holds two owners, and later
  // specs (ui-v3-approvals "select ready" / "one row per owner", -polish) need both untouched. In the full ui run
  // ui-fixc1 has already approved the first letter, so there is something to send; run alone, there is not.
  await openApprovals(page);
  const bar = page.getByTestId("send-all-bar");
  if (!(await bar.isVisible())) {
    const origin = new URL(page.url()).origin;
    const res = await page.request.post("/api/outreach/send-approved", { headers: { origin, "content-type": "application/json" }, data: {} });
    expect(res.status()).toBe(200);
    expect(((await res.json()) as { items: unknown[] }).items, "nothing approved, nothing sent").toEqual([]);
    test.info().annotations.push({ type: "send-all", description: "nothing approved on this server yet: bar hidden, endpoint sent nothing" });
    return;
  }
  const offline = /offline/i.test(await bar.innerText());
  await page.screenshot({ path: `${SHOTS}/send-all-bar-1440.png` });
  const sent = page.waitForResponse((r) => r.url().endsWith("/api/outreach/send-approved") && r.request().method() === "POST");
  await bar.getByTestId("send-all-btn").click();
  const response = await sent;
  expect(response.status()).toBe(200);
  const { items } = (await response.json()) as { items: { outreachId: string; channel: string }[] };
  const id = items.find((i) => i.channel === "letter")?.outreachId ?? items[0]!.outreachId;
  const result = page.getByTestId("send-all-result");
  await expect(result).toBeVisible();
  if (offline) {
    await expect(result).toContainText("OFFLINE — not sent");
    await expect(result).not.toContainText(/sent in test mode/);
  } else {
    // No Lob test key in e2e: nothing is mailed and the row says why. The owner link stays dead.
    await expect(result).toContainText(/not sent/);
    await expect(result).not.toContainText(/sent in test mode/);
  }

  const html = await (await page.request.get(`/api/outreach/${id}/preview`)).text();
  const token = OWNER_TOKEN.exec(html)?.[1];
  expect(token).toBeTruthy();
  await page.goto(`/owner/${token}`);
  if (!offline) {
    await expect(page.getByRole("heading", { name: "This link isn't active yet" })).toBeVisible();
    test.info().annotations.push({ type: "owner-loop", description: "skipped: not offline and no Lob test key, so nothing was sent" });
    return;
  }

  // Offline send went through the gate: the link is live, owner-facing only (no compliance badges).
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/We are holding \$[\d,]+\.\d{2} for you/);
  await expect(page.locator("main")).not.toContainText(/unverified/i);
  await page.screenshot({ path: `${SHOTS}/owner-live-1440.png`, fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.screenshot({ path: `${SHOTS}/owner-live-375.png`, fullPage: true });
  await noOverflow(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "Send me the money" }).click();
  await expect(page.getByText("Thanks, your request was sent")).toBeVisible();

  const before = await dashboardTotal(page);
  const needs = page.getByTestId("needs-you");
  await expect(needs).toContainText(/owner repl(y|ies) to act on/);
  await page.screenshot({ path: `${SHOTS}/dashboard-needs-you-owner-1440.png` });

  await openApprovals(page, "?kind=owner");
  const task = page.locator("[data-key^='t:']").first();
  await expect(task).toContainText(/^.*Reissue \$[\d,]+\.\d{2} to /);
  await task.click();
  const taskDetail = page.getByTestId("approval-detail");
  await expect(taskDetail.getByTestId("owner-reply")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/owner-task-1440.png` });
  const amount = cents(/\$[\d,]+\.\d{2}/.exec(await task.innerText())?.[0] ?? "0");
  await fillApprover(taskDetail);
  await taskDetail.getByTestId("owner-task-resolve").click();
  await expect(taskDetail.getByTestId("owner-task-resolved")).toBeVisible({ timeout: 30_000 });

  const after = await dashboardTotal(page);
  expect(amount).toBeGreaterThan(0);
  expect(before - after, "exposure drops by the resolved amount").toBe(amount);
});
