/**
 * Ask action cards (docs/ASK-MODE.md slice 3, the no-model half): "Get started", "Upload a CSV", "What needs you" and
 * "Set up integrations" render inline in Ask from deterministic intents, with no model, so they work on this keyless
 * e2e server (and with ESCHEAT_OFFLINE=1).
 *  - each card opens from typed text and from a chip; `/ask?q=` deep links send
 *  - the upload card takes the synthetic fixture through mapping, a dry-run preview with row errors, and a confirmed import
 *  - the integrations card shows env var names and "Not configured", never a value and never a connect button
 *  - the "what needs you" card links each row to the page where a person acts (coral), and approves nothing
 *  - without a model a free question cannot be sent and says why
 *  - axe, no horizontal overflow at 375 / 1024 / 1440, the disclaimer on every screen
 *
 *   E2E_PORT=3994 E2E_DIR_SUFFIX=askcards CI=1 pnpm exec playwright test tests/e2e/ui-ask-cards.spec.ts --project ui
 * Screenshots go to .data/shots/askcards/.
 */
import { mkdirSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test as base, type Locator, type Page } from "playwright/test";
import { E2E_UI_PASSCODE } from "./env";
import { firstRunSeen } from "./first-run";

/**
 * Every test signs in its own session. /api/chat rate-limits per session (a burst of 8 turns, src/lib/chat/rate-limit.ts),
 * and the shared ui storage state would make this spec's turns, and other specs', count against one bucket.
 */
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
const SHOTS = ".data/shots/askcards";
const FIXTURE = "fixtures/synthetic/ask-upload-sample.csv";

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

/** The latest assistant answer, once it has finished. */
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

/** A card answer: the card is there, labelled as a no-model setup card, with no error. */
async function expectCard(page: Page, testId: string): Promise<Locator> {
  const answer = await lastAnswer(page);
  const card = answer.getByTestId(testId);
  await expect(card).toBeVisible();
  await expect(answer.getByTestId("chat-offline-answer")).toHaveAttribute("data-reason", "card");
  await expect(answer.getByTestId("chat-error")).toHaveCount(0);
  return card;
}

async function settle(page: Page) {
  await page.waitForTimeout(600); // card entrance motion settles before a screenshot (no assertion depends on it)
}

test.beforeAll(() => mkdirSync(SHOTS, { recursive: true }));
test.describe.configure({ timeout: 180_000 });

test("Getting started opens from typed text, and its chips open the integrations and 'what needs you' cards", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openAsk(page);
  await type(page, "help");
  const started = await expectCard(page, "view-getting-started");
  await expect(started.getByTestId("getting-started-step")).toHaveCount(4);
  // Real state on the demo seed: the ledger is loaded, the rule values are still UNVERIFIED.
  await expect(started.locator('[data-step="data"]')).toHaveAttribute("data-done", "true");
  await expect(started.locator('[data-step="rules"]')).toContainText("UNVERIFIED");
  await expect(started.locator('[data-step="rules"]').getByTestId("getting-started-action")).toHaveAttribute("href", "/rules");
  await settle(page);
  await started.screenshot({ path: `${SHOTS}/getting-started-1440.png` });

  // Chip -> "What needs you".
  await started.getByRole("button", { name: "What needs me?" }).click();
  const overdue = await expectCard(page, "view-overdue");
  for (const href of await overdue.locator('[data-testid="overdue-action"], [data-testid="approval-action"]').evaluateAll((els) => els.map((e) => e.getAttribute("href") ?? ""))) {
    expect(href).toMatch(/^\/(items\?item=|approvals\?sel=)/);
  }
  await expect(overdue.getByRole("button", { name: /^Approve/ })).toHaveCount(0);
  await settle(page);
  await overdue.screenshot({ path: `${SHOTS}/overdue-1440.png` });
});

test("Integrations: typed text, names only, no connect buttons; its chips open Get started and Upload", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openAsk(page);
  await type(page, "set up");
  const card = await expectCard(page, "view-integrations-card");
  const qbo = card.locator('[data-integration="qbo"]');
  await expect(qbo).toHaveAttribute("data-state", "not configured");
  await expect(qbo).toContainText("QBO_CLIENT_ID");
  await expect(qbo.getByTestId("integration-state")).toHaveText("Not configured");
  await expect(card.locator('[data-integration="plaid"]')).toContainText("PLAID_SECRET");
  await expect(card.getByTestId("integrations-steps")).toContainText("pnpm run doctor");
  // The e2e server scrubs ANTHROPIC_API_KEY; the card must say so honestly.
  await expect(card.locator('[data-integration="anthropic"]')).toHaveAttribute("data-state", "not configured");
  await expect(card.locator("input, form, textarea")).toHaveCount(0);
  await expect(card.getByRole("button", { name: /connect/i })).toHaveCount(0);
  // The e2e secrets (test-only values) are configured but must never be printed.
  await expect(card).not.toContainText("demo-recipient@example.com");
  await settle(page);
  await card.screenshot({ path: `${SHOTS}/integrations-1440.png` });

  // Follow-up chips are cards too: Get started, then (from integrations again) Upload.
  await page.getByTestId("chat-followup").filter({ hasText: "Get started" }).click();
  await expectCard(page, "view-getting-started");
  await (await lastAnswer(page)).getByRole("button", { name: "Set up integrations" }).click();
  await expectCard(page, "view-integrations-card");
  await page.getByTestId("chat-followup").filter({ hasText: "Upload a ledger CSV" }).click();
  await expectCard(page, "view-import-card");
});

test("Overdue opens from typed text and from an /ask?q= deep link", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  await openAsk(page);
  await type(page, "what's overdue");
  await expectCard(page, "view-overdue");
  await openAsk(page, `/ask?q=${encodeURIComponent("Get started")}`);
  await expect(page.getByTestId("chat-user-message").first()).toHaveText("Get started", { timeout: 30_000 });
  await expectCard(page, "view-getting-started");
  await expect(page).toHaveURL(/\/ask$/);
});

test("Upload: the synthetic CSV goes through mapping, a preview with row errors, then a confirmed import", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const posts: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().includes("/api/ingest")) posts.push(r.postData() ?? "");
  });
  await openAsk(page);
  await type(page, "import a csv");
  const card = await expectCard(page, "view-import-card");
  expect(posts).toHaveLength(0); // mounting the card sends nothing

  await card.getByTestId("import-file").setInputFiles(FIXTURE);
  await expect(card.getByTestId("import-file-name")).toHaveText("ask-upload-sample.csv");
  expect(posts).toHaveLength(0); // choosing a file sends nothing either
  await card.getByTestId("import-read").click();

  // Suggested mapping from the non-standard headers; the person can change it.
  await expect(card.getByTestId("import-map-payeeName")).toHaveValue("Vendor");
  await expect(card.getByTestId("import-map-issueDate")).toHaveValue("Date Issued");
  await expect(card.getByTestId("import-map-number")).toHaveValue("Chk No");
  await card.getByTestId("import-map-memo").selectOption("Department");
  await expect(card.getByTestId("import-map-memo")).toHaveValue("Department");

  await card.getByTestId("import-preview-button").click();
  const preview = card.getByTestId("import-preview");
  await expect(preview).toBeVisible();
  await expect(card.getByTestId("import-preview-valid")).toHaveText("4");
  await expect(card.getByTestId("import-preview-errors")).toHaveText("2");
  const rowErrors = card.getByTestId("import-row-errors");
  await expect(rowErrors).toContainText("Line 5");
  await expect(rowErrors).toContainText("Line 6");
  await expect(rowErrors).toContainText("after today");
  await expect(preview.locator("tbody tr")).toHaveCount(4);
  await expect(preview).toContainText("Facilities"); // the remapped memo column
  expect(posts.every((p) => JSON.parse(p).preview === true || !JSON.parse(p).mapping)).toBe(true); // nothing imported yet
  await page.setViewportSize({ width: 1440, height: 2000 }); // the full card fits without the sticky bar over it
  await card.scrollIntoViewIfNeeded();
  await settle(page);
  await card.screenshot({ path: `${SHOTS}/upload-1440.png` });
  await page.setViewportSize({ width: 1440, height: 1000 });

  await card.getByTestId("import-confirm").click();
  await expect(card.getByTestId("import-result-headline")).toContainText("Imported 4 rows from ask-upload-sample.csv", { timeout: 60_000 });
  await expect(card.getByTestId("import-result")).toContainText("2 rejected");
  await expect(card.getByTestId("import-pipeline")).toBeVisible();
  const imports = posts.map((p) => JSON.parse(p) as { mapping?: unknown; preview?: boolean }).filter((b) => b.mapping && !b.preview);
  expect(imports).toHaveLength(1); // exactly one import, from the confirm click
});

test("Upload at 375px: the card fits, and a rejected file type is explained", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await openAsk(page, `/ask?q=${encodeURIComponent("Upload a ledger CSV")}`);
  const card = await expectCard(page, "view-import-card");
  await card.getByTestId("import-file").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("not a csv") });
  await expect(card.getByTestId("import-error")).toContainText('"notes.txt" is not a CSV file');
  await card.getByTestId("import-file").setInputFiles(FIXTURE);
  await card.getByTestId("import-read").click();
  await expect(card.getByTestId("import-map-payeeName")).toHaveValue("Vendor");
  await card.getByTestId("import-preview-button").click();
  await expect(card.getByTestId("import-preview-valid")).toHaveText("4");
  expect(await overflowPx(page)).toBeLessThanOrEqual(0);
  await expect(page.locator("footer").getByText("Prototype. Not legal advice.", { exact: false })).toBeVisible();
  await settle(page);
  await page.screenshot({ path: `${SHOTS}/upload-375.png` });
});

test("without a model, a free question cannot be sent and says why; a card prompt can", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openAsk(page);
  const model = (await page.getByTestId("chat-model").textContent()) ?? "";
  test.skip(!model.includes("not configured"), "only meaningful on a keyless server without ESCHEAT_OFFLINE");
  await expect(page.getByTestId("chat-not-configured")).toContainText("Chat needs ANTHROPIC_API_KEY");
  const input = page.getByTestId("chat-input");
  await expect(input).toBeEnabled();
  await input.fill("Write me a poem about Delaware");
  await expect(page.getByTestId("chat-send")).toBeDisabled();
  await expect(page.getByTestId("chat-no-model-hint")).toBeVisible();
  await input.fill("get started");
  await expect(page.getByTestId("chat-no-model-hint")).toHaveCount(0);
  await expect(page.getByTestId("chat-send")).toBeEnabled();
  // Read-only starter chips that need the model stay disabled; card chips are enabled.
  for (const chip of await page.getByTestId("chat-example").all()) {
    const text = (await chip.textContent()) ?? "";
    if (/What do we owe and where\?/.test(text)) await expect(chip).toBeDisabled();
    if (/Set up integrations|What's overdue\?|Get started|Upload a ledger CSV/.test(text)) await expect(chip).toBeEnabled();
  }
});

// One transcript with all four cards, checked at each width. (Chat turns share the session's rate limit, a burst of 8,
// so the cards are sent once and the viewport is resized rather than re-sending them per width.)
test("all four cards at 1440 / 1024 / 375px: axe clean, no horizontal overflow, disclaimer visible", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openAsk(page);
  for (const [q, id] of [
    ["get started", "view-getting-started"],
    ["set up integrations", "view-integrations-card"],
    ["what's overdue?", "view-overdue"],
    ["upload a csv", "view-import-card"],
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
});
