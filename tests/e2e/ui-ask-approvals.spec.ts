/**
 * Ask approval cards (docs/ASK-MODE.md slice 4, the no-model half): "Review approvals", "Draft outreach", "Close the
 * month" and "File the <STATE> report" render inline in Ask from deterministic intents, with no model, so they work on
 * this keyless e2e server.
 *  - each card opens from typed text and from a chip or an /ask?q= link
 *  - nothing calls an approval endpoint before a person's click (network listener)
 *  - Approve stays disabled until a name is typed
 *  - a letter approved on the review card shows as approved on /approvals (same server route as the page)
 *  - axe, no horizontal overflow at 375 / 1024 / 1440, the disclaimer on every screen
 *
 * The month close and the report approval are not clicked here (they would change state other ui specs read); their
 * equivalence with the Ledger and Approvals pages is proven in src/lib/ask/cards/approval-equivalence.db.test.ts.
 *
 *   E2E_PORT=3996 E2E_DIR_SUFFIX=askapprove CI=1 pnpm exec playwright test tests/e2e/ui-ask-approvals.spec.ts --project ui
 * Screenshots go to .data/shots/askapprove/.
 */
import { mkdirSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test as base, type Locator, type Page } from "playwright/test";
import { E2E_UI_PASSCODE } from "./env";
import { firstRunSeen } from "./first-run";

/** Every test signs in its own session: /api/chat allows a burst of 8 turns per session. */
const test = base.extend({
  page: async ({ browser, baseURL }, provide) => {
    const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [firstRunSeen(baseURL!)] } });
    const page = await context.newPage();
    await page.goto("/login", { waitUntil: "load", timeout: 90_000 });
    await expect(page.getByLabel("Passcode")).toBeEditable();
    for (let i = 0; i < 5 && new URL(page.url()).pathname.startsWith("/login"); i++) {
      await page.getByLabel("Passcode").fill(E2E_UI_PASSCODE);
      await page.getByRole("button", { name: "Enter" }).click();
      await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20_000 }).catch(() => undefined);
    }
    await expect(page).not.toHaveURL(/\/login/);
    await provide(page);
    await context.close();
  },
});

const DISCLAIMER = "Prototype. Not legal advice. Confirm filings with a qualified professional.";
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const SHOTS = ".data/shots/askapprove";
/** Every endpoint that records an approval, sends, files or closes. */
const IRREVERSIBLE_POST = /\/api\/(outreach\/[^/]+\/(approve|send)|reports\/[^/]+\/(approve|file)|recoveries\/[^/]+\/approve|close-pack|agents\/file)\b/;
const NAME = "E2E Reviewer";

async function axeBlocking(page: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page }).setLegacyMode(true).withTags(WCAG_TAGS).analyze();
  return violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
}

async function overflowPx(page: Page): Promise<number> {
  await page.evaluate(() => document.fonts.ready);
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

async function openAsk(page: Page, path = "/ask") {
  await page.goto(path, { timeout: 90_000 });
  await expect(page.getByTestId("chat-input")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("top-bar").getByTestId("mode-switch")).toHaveAttribute("data-ready", "true", { timeout: 60_000 });
}

async function lastAnswer(page: Page): Promise<Locator> {
  const last = page.getByTestId("chat-assistant-message").last();
  await expect(last).toHaveAttribute("data-status", "done", { timeout: 60_000 });
  return last;
}

async function type(page: Page, text: string) {
  const input = page.getByTestId("chat-input");
  await input.fill(text);
  await expect(page.getByTestId("chat-send")).toBeEnabled();
  await input.press("Enter");
  await expect(page.getByTestId("chat-user-message").last()).toHaveText(text, { timeout: 30_000 });
}

async function expectCard(page: Page, testId: string): Promise<Locator> {
  const answer = await lastAnswer(page);
  const card = answer.getByTestId(testId);
  await expect(card).toBeVisible();
  await expect(answer.getByTestId("chat-offline-answer")).toHaveAttribute("data-reason", "card");
  await expect(answer.getByTestId("chat-error")).toHaveCount(0);
  return card;
}

/** Records every POST to an approval / send / file / close endpoint. */
function watchIrreversible(page: Page): string[] {
  const hits: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && IRREVERSIBLE_POST.test(new URL(r.url()).pathname)) hits.push(new URL(r.url()).pathname);
  });
  return hits;
}

async function settle(page: Page) {
  await page.waitForTimeout(600); // card entrance motion settles before a screenshot (no assertion depends on it)
}

test.beforeAll(() => mkdirSync(SHOTS, { recursive: true }));
// This spec approves letter #10087, and in CI every ui spec shares one database. Put the seed back for the specs that
// run after it (ui-r4-chat drafts #10087; ui-tour reads it).
test.afterAll(async ({ request }) => {
  const res = await request.post("/api/demo/reset", { data: { confirm: true }, timeout: 180_000 });
  expect(res.status(), await res.text()).toBe(200);
});
test.describe.configure({ mode: "serial", timeout: 180_000 });

let draftedCheck: string | null = null;

test("Draft outreach: /ask?q= link and typed text; Request approval drafts from the rule file, the chip shows the letter", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const hits = watchIrreversible(page);
  await openAsk(page, `/ask?q=${encodeURIComponent("Draft letters")}`);
  await expect(page.getByTestId("chat-user-message").first()).toHaveText("Draft letters", { timeout: 30_000 });
  const card = await expectCard(page, "view-outreach-drafts");
  const requestable = card.getByTestId("draft-candidate").filter({ has: page.getByTestId("draft-request-approval") });
  await expect(requestable.first()).toBeVisible();
  // An item whose letter can actually be mailed (a missing owner address is shown, and blocks approval later).
  draftedCheck = /#(\d+)/.exec((await requestable.filter({ hasNotText: /address/i }).first().textContent()) ?? "")?.[1] ?? null;
  expect(draftedCheck).toBeTruthy();
  // Pinned by its check number: the row keeps its identity after its button is replaced by the result.
  const target = card.getByTestId("draft-candidate").filter({ hasText: `#${draftedCheck}` });
  await settle(page);
  await card.screenshot({ path: `${SHOTS}/draft-outreach-1440.png` });

  await target.getByTestId("draft-request-approval").click();
  await expect(target.getByTestId("draft-requested")).toBeVisible({ timeout: 60_000 });
  await target.getByRole("button", { name: "Show the letter" }).click();
  const shown = await expectCard(page, "view-outreach-drafts");
  const letter = shown.getByTestId("view-approval-card");
  await expect(letter).toBeVisible();
  await expect(letter.locator("pre")).toContainText(/\S{20,}/);
  await expect(letter.getByTestId("approval-state")).toHaveText("Needs your approval");
  expect(hits, "drafting approves, sends and files nothing").toEqual([]);

  // Typed text opens the same card for that item.
  await type(page, `draft outreach for #${draftedCheck}`);
  await expect((await expectCard(page, "view-outreach-drafts")).getByTestId("view-approval-card")).toBeVisible();
});

test("Review approvals: starter chip and typed text; approving a letter here shows it approved on /approvals", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const hits = watchIrreversible(page);
  await openAsk(page);
  // The starter chip (the queue has drafts waiting on the demo seed).
  await page.getByTestId("chat-example").filter({ hasText: "What needs my approval?" }).first().click();
  await expectCard(page, "view-approvals-review");
  await type(page, "Review approvals");
  const card = await expectCard(page, "view-approvals-review");
  await expect(card.getByTestId("review-group").first()).toBeVisible();
  // Pinned by check number only: the Approve button is replaced by the "approved" status after the click.
  const row = card.getByTestId("review-row").filter({ hasText: `#${draftedCheck ?? ""}` }).first();
  await expect(row.getByTestId("review-approve")).toBeVisible();
  await expect(row).toBeVisible();
  await expect(row).toContainText("Lob test mode");
  await expect(row).toContainText("Nothing is mailed");
  const approve = row.getByTestId("review-approve");
  await row.getByTestId("review-approve-name").fill("");
  await expect(approve).toBeDisabled();
  await settle(page);
  await card.screenshot({ path: `${SHOTS}/review-approvals-1440.png` });
  expect(hits, "no approval endpoint is called before the click").toEqual([]);

  await row.getByTestId("review-approve-name").fill(NAME);
  await expect(approve).toBeEnabled();
  const key = decodeURIComponent((await row.getByRole("link", { name: /Approvals/ }).getAttribute("href"))!.split("sel=")[1]!);
  await approve.click();
  await expect(row.getByTestId("review-approve-done")).toHaveText("Approved by a person", { timeout: 30_000 });
  expect(hits).toEqual([`/api/outreach/${key.slice(2)}/approve`]);

  await page.goto(`/approvals?sel=${key}`, { timeout: 90_000 });
  const detail = page.getByTestId("approval-detail");
  await expect(detail.getByText(/Approved by/).first()).toBeVisible({ timeout: 30_000 });
  await expect(detail).toContainText(NAME);
  await expect(detail.getByTestId("send-btn")).toBeVisible(); // sending is still a separate step in Approvals
  expect(hits.filter((h) => h.endsWith("/send"))).toEqual([]);
});

test("Close the month: /ask?q= link and typed month; tie-out and the name-gated close, nothing posted", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const hits = watchIrreversible(page);
  await openAsk(page, `/ask?q=${encodeURIComponent("Close the month")}`);
  await expect(page.getByTestId("chat-user-message").first()).toHaveText("Close the month", { timeout: 30_000 });
  await expectCard(page, "view-period-close");
  await type(page, "Close October 2026");
  const card = await expectCard(page, "view-period-close");
  const body = card.getByTestId("period-close-body");
  await expect(body).toHaveAttribute("data-period", "2026-10");
  await expect(card.getByTestId("period-close-tieout")).toBeVisible();
  await expect(card.getByTestId("tie-row").first()).toBeVisible();
  await expect(card).toContainText("It cannot be undone.");
  const approve = card.getByTestId("period-close-approve");
  await card.getByTestId("period-close-approve-name").fill("");
  await expect(approve).toBeDisabled();
  await card.getByTestId("period-close-approve-name").fill(NAME);
  await expect(approve).toBeEnabled();
  await settle(page);
  await card.screenshot({ path: `${SHOTS}/close-month-1440.png` });
  expect(hits, "the card closes nothing by itself").toEqual([]);
});

test("File the CA report: typed text and the card's chip; readiness with UNVERIFIED rules, routes into the existing flow", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const hits = watchIrreversible(page);
  await openAsk(page);
  await type(page, "File the CA report");
  const card = await expectCard(page, "view-filing");
  await expect(card.getByRole("heading").first()).toContainText(/CA|California/);
  await expect(card.getByTestId("filing-facts")).toContainText("Rule file");
  await expect(card.getByTestId("unverified-badge").first()).toBeVisible();
  const next = card.getByTestId("filing-next");
  await expect(next.getByRole("link").first()).toHaveAttribute("href", /^\/(reports\?state=CA|close-out\/CA)$/);
  await settle(page);
  await card.screenshot({ path: `${SHOTS}/file-report-1440.png` });
  // Chip on the card -> the review card.
  await card.getByRole("button", { name: "Review approvals" }).click();
  await expectCard(page, "view-approvals-review");
  expect(hits).toEqual([]);
});

test("all four cards at 1440 / 1024 / 375px: axe clean, no horizontal overflow, disclaimer visible", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openAsk(page);
  for (const [q, id] of [
    ["Review approvals", "view-approvals-review"],
    ["Draft letters", "view-outreach-drafts"],
    ["Close October 2026", "view-period-close"],
    ["File the CA report", "view-filing"],
  ] as const) {
    await type(page, q);
    await expectCard(page, id);
  }
  for (const width of [1440, 1024, 375] as const) {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
    expect(await overflowPx(page), `overflow at ${width}px`).toBeLessThanOrEqual(0);
    await expect(page.getByText(DISCLAIMER).first()).toBeVisible();
    expect(await axeBlocking(page), `axe at ${width}px`).toEqual([]);
  }
  await page.setViewportSize({ width: 375, height: 812 });
  await page.getByTestId("view-approvals-review").last().scrollIntoViewIfNeeded();
  await settle(page);
  await page.screenshot({ path: `${SHOTS}/review-approvals-375.png` });
});
