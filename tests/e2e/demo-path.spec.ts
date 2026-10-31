/**
 * The BRIEF's demo path (a-h) in a real browser on a freshly seeded database.
 * Runs against the "demo" server from playwright.config.ts (scripts/e2e-server.ts wipes + re-seeds it).
 *
 * Provider keys are scrubbed for the server, so Lob/AgentMail show the designed "not configured" state.
 * Re-run with ESCHEAT_OFFLINE=1 (`pnpm e2e:offline`) to assert the offline-labeled results instead; in both
 * modes the UI must never claim a letter or email was sent.
 * Deterministic: every wait is on a UI element or network state; there are no sleeps.
 */
import { expect, test, type APIRequestContext, type Page } from "playwright/test";
import { BLOCKED_RECIPIENT, E2E_SECRETS } from "./env";

const SHOTS_DIR = process.env.E2E_SHOTS_DIR;
const VIEWPORTS = [375, 1024, 1440] as const;

/** Visual QA (opt-in via E2E_SHOTS_DIR): full-page shots at 375/1024/1440 plus a scrolled-viewport shot. */
async function shoot(page: Page, url: string, name: string, opts: { scrolled?: boolean } = {}) {
  await page.emulateMedia({ reducedMotion: "reduce" }); // settle enter animations so shots are not mid-fade
  for (const width of VIEWPORTS) {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
    await page.goto(url);
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: `${SHOTS_DIR}/${name}-${width}.png`, fullPage: true });
    if (opts.scrolled) {
      await page.evaluate(() => window.scrollTo(0, Math.min(700, document.documentElement.scrollHeight)));
      await page.screenshot({ path: `${SHOTS_DIR}/${name}-${width}-scrolled.png` });
    }
  }
}

test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);
test.use({ actionTimeout: 30_000 });
// NB: `expect.configure(...)` returns a NEW expect and does not mutate the imported one, so a bare call here is a
// no-op and every assertion without its own timeout keeps the project default (5s, 15s in CI). Slow, legitimately
// long steps therefore carry an explicit timeout (see AGENT_PAUSE_TIMEOUT_MS) instead of a blanket raise.

/**
 * Worst case for the scripted filing agent to reach "Paused at 'Approve submission'" after the click: a cold
 * persistent-Chromium launch with video recording (3-10s on a loaded laptop, more on CI), then sign in, upload and
 * the portal review page (each a full navigation that may still compile on first hit), then up to one UI poll
 * (RUN_POLL_MS) and a router.refresh. 60s is several times the loaded-laptop worst case without hiding a real hang.
 */
const AGENT_PAUSE_TIMEOUT_MS = 60_000;

const OFFLINE = ["1", "true", "yes", "on"].includes((process.env.ESCHEAT_OFFLINE ?? "").trim().toLowerCase());
const CONFIRMATION = /REPL-CA-\d{4}-[A-Z0-9]{6}/;

/** Shared across the serial steps. */
const shared: { letterId?: string; ownerToken?: string; reportId?: string; dashboardTotal?: string } = {};

let consoleProblems: string[] = [];
test.beforeEach(({ page }) => {
  consoleProblems = [];
  page.on("pageerror", (e) => consoleProblems.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && /hydrat|did not match|Minified React error #4(18|23|25)/i.test(m.text())) consoleProblems.push(m.text());
  });
});
test.afterEach(() => {
  expect(consoleProblems, "no hydration errors or uncaught exceptions").toEqual([]);
});

const jsonHeaders = (baseURL: string) => ({ origin: new URL(baseURL).origin, "content-type": "application/json" });

async function dashboardTotal(page: Page): Promise<string> {
  await page.goto("/dashboard");
  const hero = page.getByRole("region", { name: "Total exposure" });
  await expect(hero.getByTestId("exposure-meta")).toContainText("stale items");
  const text = (await hero.innerText()).match(/\$[\d,]+\.\d{2}/)?.[0];
  expect(text, "dashboard total").toBeTruthy();
  return text!;
}

interface ExposureData {
  itemCount: number;
  total: { formatted: string };
  byState: { state: string; count: number }[];
}

async function mcpCall(request: APIRequestContext, baseURL: string, name: string, args: Record<string, unknown> = {}) {
  const res = await request.post("/api/mcp", {
    headers: {
      ...jsonHeaders(baseURL),
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${E2E_SECRETS.MCP_TOKEN}`,
    },
    data: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } },
  });
  expect(res.status(), await res.text()).toBe(200);
  const body = (await res.json()) as { result?: { content: { text: string }[]; isError?: boolean }; error?: unknown };
  expect(body.error).toBeUndefined();
  const text = body.result!.content[0]!.text;
  const json = /```json\n([\s\S]*?)\n```/.exec(text)?.[1];
  return { text, data: json ? (JSON.parse(json) as ExposureData) : undefined };
}

test("a) dashboard: $61,915.00, 47 items, CA 21 / TX 15 / DE 11", async ({ page }) => {
  shared.dashboardTotal = await dashboardTotal(page);
  expect(shared.dashboardTotal).toBe("$61,915.00");
  await expect(page.getByTestId("exposure-meta")).toContainText("47");
  const tile = (s: string) => page.getByTestId(`state-tile-${s}`);
  await expect(tile("CA")).toContainText("21");
  await expect(tile("CA")).toContainText("$28,410");
  await expect(tile("TX")).toContainText("15");
  await expect(tile("TX")).toContainText("$19,862");
  await expect(tile("DE")).toContainText("11");
  await expect(tile("DE")).toContainText("$13,643");
  await expect(page.getByText("Prototype. Not legal advice. Confirm filings with a qualified professional.")).toBeVisible();
});

test("b) check #10482 drawer: timeline with rule sources and UNVERIFIED", async ({ page }) => {
  await page.goto("/items?item=10482");
  const drawer = page.getByTestId("item-drawer");
  await expect(drawer).toContainText("Bayline Electric");
  await expect(drawer).toContainText("$2,340.00");
  const timeline = drawer.getByTestId("item-timeline");
  await expect(timeline).toContainText("Business threshold, not law");
  await expect(timeline.locator("a[href^='http']").first()).toBeVisible();
  await expect(drawer.getByTestId("unverified-badge").first()).toBeVisible();
});

test("g) MCP get_exposure equals the dashboard", async ({ page, request, baseURL }) => {
  const unauth = await request.post("/api/mcp", {
    headers: { ...jsonHeaders(baseURL!), accept: "application/json, text/event-stream" },
    data: { jsonrpc: "2.0", id: 1, method: "tools/list" },
  });
  expect(unauth.status()).toBe(401);

  const total = await dashboardTotal(page);
  const { text, data } = await mcpCall(request, baseURL!, "get_exposure");
  expect(text).toContain(total);
  expect(data!.itemCount).toBe(47);
  expect(data!.total.formatted).toBe(total);
  const byState = Object.fromEntries(data!.byState.map((s) => [s.state, s.count]));
  expect(byState).toMatchObject({ CA: 21, TX: 15, DE: 11 });
  expect(text).toContain("Not legal advice");
});

test("c1) letter for #10482: draft, preview, approve, send -> honest not-configured / offline state", async ({ page, request }) => {
  await page.goto("/items?item=10482");
  await page.getByTestId("item-drawer").getByRole("button", { name: "Draft outreach" }).click();
  await expect(page.getByRole("link", { name: "Review in approvals" })).toBeVisible();
  await page.goto("/approvals");
  const row = page.locator("[data-key^='o:']").filter({ hasText: "Bayline Electric" }).first();
  await expect(row).toBeVisible();
  await row.click();
  const detail = page.getByTestId("approval-detail");
  await expect(detail).toBeVisible();
  shared.letterId = (await row.getAttribute("data-key"))!.slice(2);

  const compose = detail.getByTestId("compose-btn");
  if (await compose.isVisible()) await compose.click();
  await expect(compose).toBeHidden();

  // The preview shows exactly what would be mailed (the stored HTML), with the owner link inside it.
  const letter = detail.frameLocator("iframe");
  await expect(letter.locator("body")).toContainText("Bayline Electric");
  await expect(letter.locator("body")).toContainText("2,340.00");
  if (SHOTS_DIR) await detail.screenshot({ path: `${SHOTS_DIR}/approvals-letter-preview.png` });
  await expect(detail.getByTestId("send-btn")).toBeDisabled();

  await detail.getByTestId("approve-btn").click();
  await expect(detail.getByText(/Approved by/)).toBeVisible();
  const send = detail.getByTestId("send-btn");
  await expect(send).toBeEnabled();
  await send.click();

  if (OFFLINE) {
    const outcome = detail.getByTestId("send-outcome");
    await expect(outcome).toContainText("Offline mode: nothing was sent.");
    await expect(outcome).not.toContainText(/accepted by Lob|Letter sent/i);
  } else {
    const problem = detail.getByTestId("api-problem");
    await expect(problem).toContainText(/Lob test key not configured/i);
    await expect(problem).toHaveAttribute("data-status", "501");
    await expect(detail.getByTestId("send-outcome")).toHaveCount(0);
  }

  // The stored letter carries the single-use owner link.
  const html = await (await request.get(`/api/outreach/${shared.letterId}/preview`)).text();
  const token = /\/owner\/([A-Za-z0-9_.~%-]+)/.exec(html)?.[1];
  expect(token, "owner link inside the letter").toBeTruthy();
  shared.ownerToken = token;
});

test("c2) email: non-allowlisted recipient is refused (403); allowlisted + no AgentMail key -> not configured", async ({ page, request, baseURL }) => {
  await page.goto("/approvals");
  await page.locator(`[data-key='o:${shared.letterId}']`).click();
  const detail = page.getByTestId("approval-detail");
  const drafted = page.waitForResponse((r) => r.url().endsWith("/api/outreach/draft") && r.request().method() === "POST");
  await detail.getByRole("button", { name: "Draft email" }).click();
  const emailId = ((await (await drafted).json()) as { outreachId: string }).outreachId;
  await expect(detail.getByRole("button", { name: "Email", exact: true })).toHaveAttribute("aria-pressed", "true");
  const compose = detail.getByTestId("compose-btn");
  if (await compose.isVisible()) await compose.click();
  await expect(compose).toBeHidden();

  const recipient = detail.getByLabel(/Recipient/);
  await recipient.fill(BLOCKED_RECIPIENT);
  await expect(detail.getByText(/not on the test allowlist/i)).toBeVisible();
  await expect(detail.getByTestId("approve-btn")).toBeDisabled();

  // Server-side enforcement does not depend on the disabled button.
  const reviewed = (await request.get(`/api/outreach/${emailId}/preview`)).headers()["x-content-sha256"]!;
  const res = await request.post(`/api/outreach/${emailId}/approve`, {
    headers: jsonHeaders(baseURL!),
    data: { approvedBy: "e2e", to: BLOCKED_RECIPIENT, expectedContentSha256: reviewed },
  });
  expect(res.status()).toBe(403);
  expect(((await res.json()) as { code: string }).code).toBe("recipient_not_allowed");

  await recipient.fill(E2E_SECRETS.ALLOWED_TEST_RECIPIENTS);
  await expect(detail.getByText(/Recipient is on the test allowlist/i)).toBeVisible();
  await detail.getByTestId("approve-btn").click();
  await expect(detail.getByText(/Approved by/)).toBeVisible();
  await detail.getByTestId("send-btn").click();
  if (OFFLINE) {
    await expect(detail.getByTestId("send-outcome")).toContainText("Offline mode: nothing was sent.");
  } else {
    // AGENTMAIL_INBOX_ID is set but AGENTMAIL_API_KEY is not: the send is refused with the designed not-configured state.
    const problem = detail.getByTestId("api-problem");
    await expect(problem).toContainText(/not configured/i);
    await expect(problem).toHaveAttribute("data-status", "501");
    await expect(detail.getByTestId("send-outcome")).toHaveCount(0);
  }
});

test("c3) owner link: 'Send me the money' records a response but does not resolve the item", async ({ page }) => {
  await page.goto(`/owner/${shared.ownerToken}`);
  await expect(page.getByText("2,340.00")).toBeVisible();
  if (SHOTS_DIR) await shoot(page, `/owner/${shared.ownerToken}`, "owner");
  await page.getByRole("button", { name: "Send me the money" }).click();
  await expect(page.getByText("Thanks, your request was sent")).toBeVisible();

  await page.goto("/items?item=10482");
  const drawer = page.getByTestId("item-drawer");
  await expect(drawer).toContainText(/Owner Replied/i);
  await expect(drawer).not.toContainText(/Paid Out/i);
});

test("c3b) the company marks #10482 resolved (paid) in the app; exposure drops by $2,340.00", async ({ page }) => {
  await page.goto("/items?item=10482");
  const drawer = page.getByTestId("item-drawer");
  await drawer.getByTestId("mark-resolved-btn").click();
  await drawer.getByTestId("confirm-mark-resolved").click();
  await expect(drawer.getByTestId("mark-resolved-btn")).toHaveCount(0);
  await expect(drawer.getByText("Resolved", { exact: false }).first()).toBeVisible();
  expect(await dashboardTotal(page)).toBe("$59,575.00");
});

test("d) fast-forward the demo clock: CA items reach To Report; report validates; downloads work", async ({ page, request }) => {
  await page.goto("/dashboard");
  const before = (await page.getByTestId("demo-date").innerText()).trim();
  expect(before).toBe("2026-11-01");
  await page.getByRole("button", { name: /Demo clock/ }).click();
  await page.getByRole("button", { name: "+1y" }).click();
  await expect(page.getByTestId("demo-date")).toHaveText("2027-11-01");

  await page.goto("/reports?state=CA");
  const detail = page.getByTestId("report-detail");
  await expect(detail).toBeVisible();
  const generate = page.getByTestId("generate-btn");
  await expect(generate).toBeEnabled();
  await generate.click();
  await expect(page.getByTestId("validation-summary")).toContainText("Passed with no errors");

  const fileHref = page.getByTestId("download-file");
  await expect(fileHref).toBeVisible();
  const file = await request.get((await fileHref.getAttribute("href"))!);
  expect(file.status()).toBe(200);
  const text = await file.text();
  expect(text.length).toBeGreaterThan(600);
  expect(text.startsWith("1")).toBe(true); // NAUPA HOLDER record
  const pdf = await request.get((await page.getByTestId("download-evidence").getAttribute("href"))!);
  expect(pdf.status()).toBe(200);
  expect((await pdf.body()).subarray(0, 4).toString()).toBe("%PDF");
  shared.reportId = (await fileHref.getAttribute("href"))!.split("/")[3];
});

test("e) filing agent pauses at 'Approve submission' (not submitted) until a human approves in the app", async ({ page, request }) => {
  await page.goto("/reports?state=CA");
  // Nothing can be approved before the agent has filled the portal and paused.
  await expect(page.getByTestId("approve-report-btn")).toHaveCount(0);
  await page.getByTestId("run-filing-btn").click();

  await expect(page.getByText(/Paused at 'Approve submission'/).first()).toBeVisible({ timeout: AGENT_PAUSE_TIMEOUT_MS });
  await expect(page.getByTestId("filing-confirmed")).toHaveCount(0);
  const mid = (await (await request.get(`/api/agents/reports?id=${shared.reportId}`)).json()) as { status: string; replicaConfirmation?: string | null };
  expect(mid.status).toBe("awaiting_approval");
  expect(mid.replicaConfirmation ?? null).toBeNull();

  const approve = page.getByTestId("approve-report-btn");
  await expect(approve).toBeVisible();
  await approve.click();

  await expect(page.getByTestId("filing-confirmed")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId("confirmation-number")).toHaveText(CONFIRMATION);
});

test("f) recovery agent finds $1,180.00 (TX, NORTHWIND variant); approve claim, file claim, confirmation", async ({ page }) => {
  await page.goto("/recoveries");
  await page.getByTestId("run-recovery-btn").click();
  const card = page.getByTestId("recovery-card").first();
  await expect(card).toBeVisible({ timeout: 90_000 });
  await expect(card).toContainText("$1,180.00");
  await expect(card).toContainText("TX");
  await expect(card.getByTestId("matched-variant")).toContainText(/NORTHWIND/i);

  await expect(card.getByTestId("file-claim-btn")).toHaveCount(0); // no filing before approval
  await card.getByTestId("approve-claim-btn").click();
  await card.getByTestId("file-claim-btn").click();
  await expect(card).toContainText(/REPL-CLM-TX-\d{4}-[A-Z0-9]{6}/, { timeout: 90_000 });
});

test("h) eval: method label and accuracy", async ({ page }) => {
  await page.goto("/eval");
  await expect(page.getByTestId("eval-method-label")).toHaveText(/Heuristic baseline|Replay|Model/);
  await expect(page.getByTestId("eval-method-label")).not.toHaveText(/Method not recorded/);
  await expect(page.getByTestId("eval-overall")).toHaveText(/^\d{1,3}(\.\d)?%$/);
});

test("z) visual QA screenshots (only with E2E_SHOTS_DIR)", async ({ page }) => {
  test.skip(!SHOTS_DIR, "set E2E_SHOTS_DIR to capture screenshots");
  test.setTimeout(600_000);
  const pages: [string, string, boolean][] = [
    ["/", "home", true],
    ["/how-it-works", "how-it-works", true],
    ["/security", "security", true],
    ["/chat", "chat-empty", false],
    ["/dashboard", "dashboard", false],
    ["/items", "items", true],
    ["/items?item=10482", "item-drawer", false],
    ["/approvals", "approvals", true],
    ["/rules", "rules", false],
    ["/reports?state=CA", "reports", true],
    ["/recoveries", "recoveries", false],
    ["/runs", "runs", false],
    ["/eval", "eval", false],
    ["/settings/integrations", "settings", false],
    ["/replica/ca-holder", "replica-ca-holder", false],
    ["/replica/tx-search", "replica-tx-search", false],
    ["/login", "login", false],
  ];
  for (const [url, name, scrolled] of pages) await shoot(page, url, name, { scrolled });
});
