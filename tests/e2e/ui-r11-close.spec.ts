/**
 * R11-01 / R11-04 (dogfood round 11): a closed month stays closed, and months close in order.
 *   1. /ledger: close Oct 2026 (typed name). The close section reads "Closed Nov 1, 2026 by …" with the frozen closing.
 *   2. Ask upload card: import two synthetic rows dated years back (the dogfood repro).
 *   3. /ledger: Oct still shows the frozen closing; Nov (the default month now) shows a labelled prior-period adjustment
 *      line and still ties; Sep explains why it cannot close and offers no close. The server refuses Sep with 409.
 *   4. Ask: the Oct card shows the frozen figures labelled "Closed … by …" and where the late rows posted; "Close the
 *      month" defaults to Nov 2026 with the adjustment line.
 * Axe (serious/critical) clean and no horizontal overflow at 375 and 1440. Screenshots to .data/shots/r11close/.
 * The demo seed is reset in afterAll (and beforeAll, so earlier specs' closes cannot leak in). Synthetic data only.
 */
import { mkdirSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test as base, type Locator, type Page } from "playwright/test";
import { E2E_UI_PASSCODE } from "./env";
import { firstRunSeen } from "./first-run";

/** Every test signs in its own session (the chat burst limit is per session). */
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
const SHOTS = ".data/shots/r11close";
const NAME = "Dana Reviewer";
const BACKDATED = [
  "kind,number,payee_name,payee_address,payee_city,payee_state,payee_zip,amount,issue_date,voided,memo",
  "vendor_check,88001,Backdated Supply Co,1 Elm St,Fresno,CA,93701,733.10,2023-10-12,false,late import",
  "vendor_check,88002,Backdated Freight LLC,2 Oak St,Austin,TX,78701,615.25,2021-10-09,false,late import",
].join("\n");

test.describe.configure({ mode: "serial", timeout: 240_000 });

async function reset(request: import("playwright/test").APIRequestContext) {
  const res = await request.post("/api/demo/reset", { data: { confirm: true }, timeout: 180_000 });
  expect(res.ok()).toBe(true);
}

test.beforeAll(async ({ request }) => {
  mkdirSync(SHOTS, { recursive: true });
  await reset(request);
});
test.afterAll(async ({ request }) => reset(request));

async function axeBlocking(page: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page }).setLegacyMode(true).withTags(WCAG_TAGS).analyze();
  return violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.length}`);
}

async function overflowPx(page: Page): Promise<number> {
  await page.evaluate(() => document.fonts.ready);
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

async function openLedger(page: Page, width: number) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
  await page.goto("/ledger", { timeout: 90_000 });
  await expect(page.getByTestId("close-pack-button")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(DISCLAIMER).first()).toBeVisible();
  await page.waitForLoadState("networkidle").catch(() => undefined);
}

async function pickMonth(page: Page, ym: string) {
  await page.getByTestId("close-pack-month").selectOption(ym);
  await expect(page.getByTestId("close-pack-month")).toHaveValue(ym);
}

async function openAsk(page: Page, path = "/ask") {
  await page.goto(path, { timeout: 90_000 });
  await expect(page.getByTestId("chat-input")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("top-bar").getByTestId("mode-switch")).toHaveAttribute("data-ready", "true", { timeout: 60_000 });
}

async function type(page: Page, text: string) {
  const input = page.getByTestId("chat-input");
  await input.fill(text);
  await expect(page.getByTestId("chat-send")).toBeEnabled();
  await input.press("Enter");
  await expect(page.getByTestId("chat-user-message").last()).toHaveText(text, { timeout: 30_000 });
}

async function expectCard(page: Page, testId: string): Promise<Locator> {
  const last = page.getByTestId("chat-assistant-message").last();
  await expect(last).toHaveAttribute("data-status", "done", { timeout: 60_000 });
  const card = last.getByTestId(testId);
  await expect(card).toBeVisible();
  return card;
}

let frozenClosing = "";

test("close Oct 2026 on /ledger: the close section shows who closed it, when, and the frozen closing", async ({ page }) => {
  await openLedger(page, 1440);
  await pickMonth(page, "2026-10");
  await page.getByTestId("close-month-open").click();
  await page.getByLabel("Approving as").fill(NAME);
  await page.getByTestId("close-month-confirm").click();
  await expect(page.getByTestId("close-status")).toBeVisible({ timeout: 90_000 });
  await pickMonth(page, "2026-10");
  const frozen = page.getByTestId("close-frozen");
  await expect(frozen).toContainText(`Closed Nov 1, 2026 by ${NAME}`);
  frozenClosing = (await page.getByTestId("close-frozen-closing").getAttribute("data-cents"))!;
  expect(Number(frozenClosing)).toBeGreaterThan(0);
});

test("a backdated import through the Ask upload card is accepted (2 new stale items)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openAsk(page);
  await type(page, "import a csv");
  const card = await expectCard(page, "view-import-card");
  await card.getByTestId("import-file").setInputFiles({ name: "backdated.csv", mimeType: "text/csv", buffer: Buffer.from(BACKDATED) });
  await card.getByTestId("import-read").click();
  await card.getByTestId("import-preview-button").click();
  await expect(card.getByTestId("import-preview-valid")).toHaveText("2");
  await card.getByTestId("import-confirm").click();
  await expect(card.getByTestId("import-pipeline")).toContainText("2 new stale", { timeout: 90_000 });
});

test("/ledger after the import: Oct frozen, Nov carries the labelled adjustment and ties, Sep cannot close", async ({ page, request }) => {
  for (const w of [375, 1440] as const) {
    await openLedger(page, w);
    // R11-04: the selector opens on the next closable month, Nov 2026
    await expect(page.getByTestId("close-pack-month")).toHaveValue("2026-11");
    await expect(page.getByTestId("close-month-open")).toBeEnabled();
    // R11-01: the open month shows the late rows as one labelled line, and the books still tie
    const note = page.getByTestId("ledger-prior-period");
    await expect(note).toContainText("Prior-period adjustment: 2 rows dated in closed months (Apr 2022, Apr 2024), +$1,348.35.");
    await expect(page.getByTestId("roll-priorPeriod")).toBeVisible();
    await expect(page.getByTestId("ledger-closing")).toHaveAttribute("data-reconciles", "true");
    expect(await overflowPx(page)).toBeLessThanOrEqual(0);
    expect(await axeBlocking(page)).toEqual([]);
    await page.screenshot({ path: `${SHOTS}/ledger-nov-adjustment-${w}.png`, fullPage: false });
    await note.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SHOTS}/ledger-nov-adjustment-note-${w}.png`, fullPage: false });

    await page.evaluate(() => window.scrollTo(0, 0));
    await pickMonth(page, "2026-10");
    await expect(page.getByTestId("close-frozen")).toContainText(`Closed Nov 1, 2026 by ${NAME}`);
    await expect(page.getByTestId("close-frozen-closing")).toHaveAttribute("data-cents", frozenClosing);
    await page.screenshot({ path: `${SHOTS}/ledger-oct-frozen-${w}.png`, fullPage: false });

    await pickMonth(page, "2026-09");
    await expect(page.getByTestId("close-month-blocked")).toContainText("inside books already closed through Oct 2026");
    await expect(page.getByTestId("close-month-open")).toBeDisabled();
    expect(await axeBlocking(page)).toEqual([]);
    expect(await overflowPx(page)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `${SHOTS}/ledger-sep-blocked-${w}.png`, fullPage: false });
  }
  // the server refuses it too, whatever the client sends
  const res = await request.post("/api/close-pack", { data: { period: "2026-09", approvedBy: NAME, expectedJournalSha256: "0".repeat(64) } });
  expect(res.status()).toBe(409);
  expect(((await res.json()) as { code: string }).code).toBe("out_of_order");
});

test("Ask: the Oct card shows the frozen figures and where late rows posted; Close the month defaults to Nov", async ({ page }) => {
  for (const w of [375, 1440] as const) {
    await page.setViewportSize({ width: w, height: w === 375 ? 812 : 1000 });
    await openAsk(page);
    await type(page, "Close October 2026");
    const oct = await expectCard(page, "view-period-close");
    await expect(oct.getByTestId("period-close-body")).toHaveAttribute("data-status", "closed");
    // the server labels the approver with the passcode session ("Dana Reviewer (passcode session …)")
    await expect(oct.getByTestId("period-close-closed-by")).toContainText(`Closed Nov 1, 2026 by ${NAME}`);
    await expect(oct.getByTestId("period-close-tieout")).toContainText("Frozen at close");
    await expect(oct.getByTestId("period-close-late")).toContainText("2 rows dated in or before Oct 2026 arrived (+$1,348.35). They post to Nov 2026 as a prior-period adjustment");
    await expect(oct.getByTestId("period-close-approve")).toHaveCount(0);
    expect(await overflowPx(page)).toBeLessThanOrEqual(0);
    await oct.screenshot({ path: `${SHOTS}/ask-oct-frozen-${w}.png` });

    await type(page, "Close the month");
    const nov = await expectCard(page, "view-period-close");
    await expect(nov.getByTestId("period-close-body")).toHaveAttribute("data-period", "2026-11");
    await expect(nov.getByTestId("period-close-adjustment")).toContainText("Prior-period adjustment: 2 rows");
    await expect(nov.getByTestId("period-close-blocked")).toHaveCount(0);
    expect(await axeBlocking(page)).toEqual([]);
    await nov.screenshot({ path: `${SHOTS}/ask-nov-adjustment-${w}.png` });

    await type(page, "Close September 2026");
    const sep = await expectCard(page, "view-period-close");
    await expect(sep.getByTestId("period-close-blocked")).toContainText("closed through Oct 2026");
    await expect(sep.getByTestId("period-close-approve")).toHaveCount(0);
    await expect(sep.getByRole("button", { name: "Close Nov 2026" })).toBeVisible();
    await sep.screenshot({ path: `${SHOTS}/ask-sep-blocked-${w}.png` });
  }
});
