/**
 * R8 Escheat Ledger (/ledger): the unclaimed-property liability roll-forward and its journal entries.
 *  - Fresh seed: "Since start" identified is the dashboard headline ($61,915.00), and so is the FY 2026 closing (on the
 *    seed, items stale before 2026 are FY 2026's opening, so FY identified alone is smaller).
 *  - The TX close-out runs through the API (generate -> approve anyway under a typed name -> filing agent on the replica
 *    portal -> record the remittance); the waterfall then shows "Remitted −$773.74", the closing still reconciles and
 *    the journal is Balanced. Clicking the bar lists the remitted item.
 *  - "Export JE CSV" downloads a file whose debits equal its credits (nothing is posted anywhere).
 *  - axe serious/critical clean, no horizontal overflow at 375/1024/1440, reduced motion leaves the bars static.
 * Self-contained: reseeds the demo before (so earlier specs' residue cannot move the figures) and after (so the TX
 * filing does not leak into later specs, which expect the seeded late TX item). Shots: .data/shots/r8-ledger/.
 */
import { mkdirSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext, type Page } from "playwright/test";
import type { RunnerView } from "../../src/lib/close-out/runner-model";
import { finishAnimations } from "./animations";

const SHOTS = ".data/shots/r8-ledger";
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const DISCLAIMER = "Prototype. Not legal advice. Confirm filings with a qualified professional.";
const APPROVER = "E2E Ledger Closer";
const MINUS = "−";

test.describe.configure({ mode: "serial", timeout: 900_000 });

async function reseed(request: APIRequestContext) {
  const res = await request.post("/api/demo/reset", { data: { confirm: true }, timeout: 180_000 });
  expect(res.status(), await res.text()).toBe(200);
}

test.beforeAll(async ({ request }) => {
  mkdirSync(SHOTS, { recursive: true });
  await reseed(request);
});
test.afterAll(async ({ request }) => {
  await reseed(request);
});

async function openLedger(page: Page, query = "") {
  await page.goto(`/ledger${query}`, { timeout: 90_000 });
  await expect(page.getByTestId("ledger")).toBeVisible({ timeout: 60_000 });
}

async function runner(request: APIRequestContext): Promise<RunnerView> {
  const res = await request.get("/api/close-out/runner?state=TX");
  expect(res.status(), await res.text()).toBe(200);
  return ((await res.json()) as { runner: RunnerView }).runner;
}

async function axeBlocking(page: Page): Promise<string[]> {
  await expect
    .poll(
      async () => {
        await finishAnimations(page);
        return page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running" && a.effect?.getComputedTiming().iterations !== Infinity).length);
      },
      { timeout: 20_000 },
    )
    .toBe(0);
  const { violations } = await new AxeBuilder({ page }).setLegacyMode(true).withTags(WCAG_TAGS).analyze();
  return violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
}
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test("fresh seed: Since start identified and the FY 2026 closing equal the dashboard headline", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openLedger(page, "?period=all");
  await expect(page.getByRole("heading", { level: 1, name: "Escheat Ledger" })).toBeVisible();
  await expect(page.getByText(DISCLAIMER)).toBeVisible();
  await expect(page.getByTestId("recognition-policy")).toContainText("Recognized when stale (180-day business threshold, not law).");
  await expect(page.getByTestId("ledger-identified")).toHaveText("$61,915.00");
  await expect(page.getByTestId("ledger-closing")).toHaveText("$61,915.00");

  // FY 2026 chip (URL state).
  await page.getByTestId("ledger-period").getByRole("radio", { name: "FY 2026" }).click();
  await expect(page).toHaveURL(/period=fy|\/ledger$/);
  await expect(page.getByTestId("ledger")).toHaveAttribute("data-period", "fy", { timeout: 30_000 });
  await expect(page.getByTestId("ledger-closing")).toHaveText("$61,915.00");
  await expect(page.getByTestId("ledger-closing")).toHaveAttribute("data-reconciles", "true");
  await expect(page.getByTestId("balanced-badge")).toHaveText("Balanced");
  // The dashboard says the same.
  await page.goto("/dashboard");
  await expect(page.getByRole("region", { name: "Total exposure" })).toContainText("$61,915.00", { timeout: 60_000 });
});

test("TX close-out through the API, then the waterfall shows Remitted −$773.74 and still balances", async ({ page, request }) => {
  // 1. Generate + validate the TX report.
  const before = await runner(request);
  if (before.steps.find((s) => s.id === "report_generate")?.tone === "machine") {
    const gen = await request.post("/api/reports", { data: { state: "TX" } });
    expect(gen.status(), await gen.text()).toBe(201);
  }
  // 2. A person approves it under a typed name, acknowledging exactly the counts the server names.
  const mid = await runner(request);
  const ctl = mid.steps.find((s) => s.id === "report_approve")?.control;
  expect(ctl?.op).toBe("approve_report");
  if (ctl?.op !== "approve_report") return;
  const approved = await request.post("/api/close-out/runner/approve-report", {
    data: { state: "TX", reportId: ctl.reportId, approvedBy: APPROVER, expectedChecksum: ctl.expectedChecksum, acknowledgedUnverified: ctl.unverifiedCount, acknowledgedUnsent: ctl.unsentNotices.length },
  });
  expect(approved.ok(), await approved.text()).toBe(true);
  // 3. The filing agent files it on the replica portal.
  const start = await request.post("/api/agents/file", { data: { reportId: ctl.reportId } });
  expect(start.status(), await start.text()).toBe(202);
  const runId = ((await start.json()) as { runId: string }).runId;
  await expect
    .poll(async () => ((await (await request.get(`/api/agents/runs/${runId}`)).json()) as { status: string }).status, { timeout: 240_000, intervals: [1000, 2000] })
    .toBe("succeeded");
  // 4. Record the remittance (a person, a date, a reference; nothing is paid from the app).
  const filed = await runner(request);
  const remit = filed.steps.find((s) => s.id === "remit")?.control;
  expect(remit?.op).toBe("record_remittance");
  if (remit?.op !== "record_remittance") return;
  expect(remit.expectedCents).toBe(77_374);
  const rec = await request.post("/api/close-out/remit", {
    data: { state: "TX", reportId: remit.reportId, approvedBy: APPROVER, remittedOn: remit.defaultDate, reference: "WIRE-LEDGER-1", expectedCount: remit.expectedCount, expectedCents: remit.expectedCents },
  });
  expect(rec.ok(), await rec.text()).toBe(true);

  // The ledger, FY 2026: a Remitted bar of −$773.74, the closing still ties, the journal balances.
  await page.setViewportSize({ width: 1440, height: 900 });
  await openLedger(page, "?period=fy");
  const bar = page.getByRole("button", { name: new RegExp(`^Remitted ${MINUS}\\$773\\.74`) });
  await expect(bar).toBeVisible();
  await expect(page.getByTestId("roll-remitted").locator('td[data-state="TX"]')).toHaveText(`${MINUS}$773.74`);
  await expect(page.getByTestId("ledger-closing")).toHaveText("$61,141.26");
  await expect(page.getByTestId("ledger-closing")).toHaveAttribute("data-reconciles", "true");
  await expect(page.getByTestId("roll-check")).not.toContainText("Does not tie");
  await expect(page.getByTestId("balanced-badge")).toHaveText("Balanced");
  await expect(page.getByTestId("je-state-balanced")).toHaveCount(await page.getByTestId("je-state").count());
  for (const b of await page.getByTestId("je-state-balanced").all()) await expect(b).toHaveText("Balanced");
  // The remittance entry cites the replica confirmation and the wire reference; its filing relied on UNVERIFIED rules.
  const tx = page.locator('[data-testid="je-state"][data-state="TX"]');
  await expect(tx).toContainText(/REPL-TX-\d{4}-[A-Z0-9]{6} \/ WIRE-LEDGER-1/);
  await expect(tx.getByTestId("unverified-badge").first()).toBeVisible();

  // Clicking the bar lists the item behind it.
  await bar.click();
  const panel = page.getByTestId("ledger-bar-items");
  await expect(panel).toHaveAttribute("data-bar-id", "remitted");
  await expect(panel).toContainText("1 item");
  await expect(panel).toContainText("$773.74");
  await expect(panel.getByRole("link", { name: /Open in Items/ })).toHaveAttribute("href", "/items?status=remitted");
  // Per state: TX alone.
  await page.getByRole("radio", { name: "TX" }).click();
  await expect(page).toHaveURL(/state=TX/);
  await expect(page.getByTestId("ledger-waterfall")).toHaveAttribute("data-scope", "TX");
  await expect(page.getByRole("button", { name: new RegExp(`^Remitted ${MINUS}\\$773\\.74`) })).toBeVisible();
  await page.getByRole("radio", { name: "All states" }).click();

  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await finishAnimations(page);
    await page.screenshot({ path: `${SHOTS}/ledger-fy-${width}.png`, fullPage: true, animations: "disabled" });
  }
});

test("Export JE CSV downloads a balanced file", async ({ page, request }) => {
  await openLedger(page, "?period=fy");
  await expect(page.getByTestId("ledger-export")).toHaveAttribute("href", "/api/ledger.csv?period=fy");
  const res = await request.get("/api/ledger.csv?period=fy");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("text/csv");
  expect(res.headers()["content-disposition"]).toMatch(/attachment; filename="escheat-je-fy-/);
  const rows = (await res.text()).trimEnd().split("\r\n");
  expect(rows[0]).toBe("Date,JE#,Account,Debit,Credit,Memo,Ref");
  const cells = rows.slice(1).map((r) => r.match(/("([^"]|"")*"|[^,]*)(,|$)/g)!.map((c) => c.replace(/,$/, "")));
  const cents = (s: string | undefined) => (s ? Math.round(Number(s) * 100) : 0);
  const debit = cells.reduce((a, c) => a + cents(c[3]), 0);
  const credit = cells.reduce((a, c) => a + cents(c[4]), 0);
  expect(debit).toBeGreaterThan(0);
  expect(debit).toBe(credit);
  expect(rows.some((r) => r.includes("2400-TX Unclaimed property payable (TX),773.74,"))).toBe(true);
  // Browser download from the button.
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("ledger-export").click()]);
  expect(download.suggestedFilename()).toMatch(/^escheat-je-fy-.*\.csv$/);
});

test("axe clean, no overflow at 375/1024/1440, reduced motion keeps the bars static", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const width of [375, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await openLedger(page, "?period=fy");
    await expect(page.getByTestId("waterfall")).toHaveAttribute("data-animate", "false");
    expect(await overflow(page), `overflow at ${width}`).toBeLessThanOrEqual(0);
    expect(await axeBlocking(page), `axe at ${width}`).toEqual([]);
  }
  // Keyboard: the bars are reachable and open the item list.
  await page.getByTestId("waterfall-bar").first().focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("ledger-bar-items")).toHaveAttribute("data-bar-id", "opening");
  await page.screenshot({ path: `${SHOTS}/ledger-reduced-1440.png`, fullPage: true, animations: "disabled" });
});
