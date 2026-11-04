/**
 * Round 4 chat (R4-03, R4-26).
 *  - R4-03: the scripted demo drafts #10087 (window open now). A draft for #10482 (window opens Oct 31, 2028) is refused
 *    with the reason and the date, exactly like bulk draft, and creates nothing.
 *  - R4-26: offline, an off-script question or the end of a recorded conversation shows recorded prompts as chips that replay.
 *  - R5-16: a refusal reads as a rule declining (neutral, "declined by a rule"), not a pink failure, and never offers to
 *    move the demo clock; recovery chips after a real answer say the recorded conversation ended and skip what was asked.
 *  - R5-11: axe (legacy mode) clean and no horizontal overflow at 375/1024/1440, also once the exposure card renders.
 *
 * Offline tests need the server started with ESCHEAT_OFFLINE=1 (passes through scripts/e2e-server.ts); otherwise they skip:
 *   ESCHEAT_OFFLINE=1 E2E_PORT=3911 E2E_DIR_SUFFIX=r4-chat CI=1 pnpm exec playwright test tests/e2e/ui-r4-chat.spec.ts --project ui
 * Writes /Users/ronitkatikaneni/escheat-agent/.data/shots/r4-r4-chat/ when R4_SHOTS_DIR is set.
 */
import { mkdirSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "playwright/test";

const DISCLAIMER = "Prototype. Not legal advice. Confirm filings with a qualified professional.";
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const SHOTS = process.env.R4_SHOTS_DIR;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

async function openChat(page: Page) {
  await page.goto("/chat", { timeout: 90_000 });
  await expect(page.getByTestId("chat-input")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(DISCLAIMER)).toBeVisible();
}

async function isOffline(page: Page): Promise<boolean> {
  return ((await page.getByTestId("chat-model").textContent()) ?? "").includes("offline");
}

async function lastAnswerDone(page: Page) {
  const last = page.getByTestId("chat-assistant-message").last();
  await expect(last).not.toHaveAttribute("data-status", "streaming", { timeout: 60_000 });
  return last;
}

async function lastAnswerReplayed(page: Page) {
  const last = await lastAnswerDone(page);
  await expect(last).toHaveAttribute("data-status", "done");
  await expect(last.getByTestId("chat-error")).toHaveCount(0);
  return last;
}

async function axeBlocking(page: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page }).setLegacyMode(true).withTags(WCAG_TAGS).analyze();
  return violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes[0]?.target.join(" ")}`);
}

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

test.describe("chat R4", () => {
  test("the scripted demo drafts #10087 for approval, then offers recorded prompts instead of a dead end", async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openChat(page);
    test.skip(!(await isOffline(page)), "Needs the e2e server started with ESCHEAT_OFFLINE=1");

    await page.getByTestId("chat-example").filter({ hasText: "What do we owe and where?" }).click();
    await lastAnswerReplayed(page);
    // F36: the follow-up chip is the recorded next turn, and it replays.
    const next = page.getByTestId("chat-followup").filter({ hasText: "Explain check #10087" });
    await expect(next).toBeVisible();
    await next.click();
    await lastAnswerReplayed(page);
    await page.getByTestId("chat-followup").filter({ hasText: "Draft the due-diligence letter for #10087" }).click();
    const draft = await lastAnswerReplayed(page);
    await expect(draft).toContainText(/Ravenhill/i);
    await expect(draft).toContainText(/awaiting|approval/i);

    // End of the recorded conversation: nothing continues it, so recorded first-turn prompts are offered.
    const recovery = page.getByTestId("chat-recovery");
    await expect(recovery).toBeVisible();
    await expect(page.getByTestId("chat-recovery-note")).toContainText("end of this recorded conversation");
    await expect(page.getByTestId("chat-recovery-chip").filter({ hasText: "Draft the due-diligence letter for #10087" })).toHaveCount(0);
    await shot(page, "chat-recovery-1440");
    const chip = page.getByTestId("chat-recovery-chip").first();
    const text = (await chip.innerText()).trim();
    await chip.click();
    await expect(page.getByTestId("chat-user-message")).toHaveCount(1);
    await expect(page.getByTestId("chat-user-message")).toHaveText(text);
    await lastAnswerReplayed(page);
  });

  test("an off-script question shows recorded prompts as chips, and a chip replays", async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 375, height: 900 });
    await openChat(page);
    test.skip(!(await isOffline(page)), "Needs the e2e server started with ESCHEAT_OFFLINE=1");

    await page.getByTestId("chat-input").fill("How much interest do we owe Texas?");
    await page.getByTestId("chat-send").click();
    const answer = await lastAnswerDone(page);
    await expect(answer.getByTestId("chat-error")).toContainText(/no recorded answer/i);
    const recovery = page.getByTestId("chat-recovery");
    await expect(recovery).toBeVisible();
    await shot(page, "chat-offscript-375");
    const chips = page.getByTestId("chat-recovery-chip");
    expect(await chips.count()).toBeGreaterThan(0);
    await chips.first().click();
    await expect(page.getByTestId("chat-user-message")).toHaveCount(1);
    await lastAnswerReplayed(page);
  });

  test("chat refuses a draft for #10482 with the window date, and creates nothing", async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openChat(page);
    test.skip(!(await isOffline(page)), "Needs the e2e server started with ESCHEAT_OFFLINE=1");

    await page.getByTestId("chat-input").fill("Draft the due-diligence letter for #10482");
    await page.getByTestId("chat-send").click();
    const answer = await lastAnswerDone(page);
    await expect(answer).toContainText("October 31, 2028");
    await expect(answer).toContainText(/may not count/i);
    await expect(answer.getByTestId("view-approval-card")).toHaveCount(0);
    // R5-16: a rule said no. Neutral note (pink means a person must act), counted as declined, not failed.
    await expect(answer.getByTestId("view-refusal")).toBeVisible();
    await expect(answer.getByTestId("view-error")).toHaveCount(0);
    await expect(answer.getByTestId("chat-tool-trace")).toHaveAttribute("data-state", "refused");
    await expect(answer.getByTestId("chat-tool-trace")).toContainText("declined by a rule");
    await expect(answer.getByTestId("chat-tool-trace")).not.toContainText("failed");
    await expect(answer).not.toContainText(/demo clock/i);
    await shot(page, "chat-early-refusal-1440");
  });

  for (const width of [375, 1024, 1440] as const) {
    test(`chat @${width}px: no horizontal overflow, axe clean`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
      await openChat(page);
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
      expect(await axeBlocking(page)).toEqual([]);
    });
  }

  // R5-11: one recorded answer (the chat rate limit allows a few turns a minute), checked at every width.
  test("the exposure card is axe clean and fits at 375/1024/1440", async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openChat(page);
    test.skip(!(await isOffline(page)), "Needs the e2e server started with ESCHEAT_OFFLINE=1");
    await page.getByTestId("chat-example").filter({ hasText: "What do we owe and where?" }).click();
    const answer = await lastAnswerReplayed(page);
    await expect(answer.getByTestId("view-exposure")).toBeVisible();
    // The state rows are buttons whose accessible name starts with their visible text (label-content-name-mismatch).
    await expect(answer.getByRole("button", { name: /^CA\s*\$[\d,]+\.\d{2}\s*\d+ items/ })).toBeVisible();
    for (const width of [375, 1024, 1440] as const) {
      await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
      await page.waitForTimeout(800); // let the card's number flow settle
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
      expect(await axeBlocking(page), `axe at ${width}px`).toEqual([]);
      await shot(page, `chat-exposure-${width}`);
    }
  });
});
