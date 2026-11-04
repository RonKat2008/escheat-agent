/**
 * Round 8, approvals + filing slice:
 *  - R8-03 the filing agent refuses to start without a current approval, and starts once approved
 *  - R8-08 approvals after sending: status-aware heading, no colliding row text, amount stays inside the list pane
 *  - axe (legacy mode) and no horizontal overflow at 375/1440; screenshots in .data/shots/r8-approvals/
 */
import { mkdirSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "playwright/test";
import { finishAnimations } from "./animations";
import { approveReportApi, fillApprover } from "./approver";

const SHOTS = ".data/shots/r8-approvals";

test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);
test.beforeAll(() => mkdirSync(SHOTS, { recursive: true }));
// This spec files a report and sends a letter. In CI all ui specs share one database, so put the seed back
// for the specs that run after it (ui-v3-late-money reads the seed's late TX money).
test.afterAll(async ({ request }) => {
  const res = await request.post("/api/demo/reset", { data: { confirm: true }, timeout: 180_000 });
  expect(res.status(), await res.text()).toBe(200);
});

test("R8-03: POST /api/agents/file is refused without approval, and starts once a person approved", async ({ request }) => {
  let report: { reportId: string; checksum: string } | null = null;
  for (const state of ["DE", "TX", "CA"]) {
    const gen = await request.post("/api/reports", { data: { state } });
    if (gen.status() !== 201) continue;
    const body = (await gen.json()) as { reportId: string; status: string; checksum: string };
    if (body.status === "validated") {
      report = body;
      break;
    }
  }
  test.skip(!report, "no state could generate a validated report on this database");

  const refused = await request.post("/api/agents/file", { data: { reportId: report!.reportId } });
  expect(refused.status(), await refused.text()).toBe(409);
  const refusal = (await refused.json()) as { code: string; error: string };
  expect(refusal.code).toBe("approval_required");
  expect(refusal.error).toMatch(/approval required/i);

  const approve = await approveReportApi(request, report!.reportId, report!.checksum);
  expect(approve.status(), await approve.text()).toBe(201);
  const start = await request.post("/api/agents/file", { data: { reportId: report!.reportId } });
  expect(start.status(), await start.text()).toBe(202);
  const { runId } = (await start.json()) as { runId: string };
  expect(runId).toMatch(/^[0-9a-f-]{36}$/);
  await expect
    .poll(async () => ((await (await request.get(`/api/agents/runs/${runId}`)).json()) as { status?: string }).status, { timeout: 150_000, intervals: [1000, 2000] })
    .toBe("succeeded");
});

/** Approves and sends the first letter (from the last row up) whose readiness allows it, so the queue has a "Recently handled" row. */
async function sendAnyLetter(page: Page): Promise<boolean> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/approvals?kind=letter");
  const rows = page.locator("[data-key^='o:']");
  await expect(rows.first()).toBeVisible({ timeout: 30_000 });
  const total = await rows.count();
  for (let i = total - 1; i >= 0; i--) {
    await rows.nth(i).click();
    const detail = page.getByTestId("approval-detail");
    const compose = detail.getByTestId("compose-btn");
    if (await compose.isVisible()) await compose.click();
    await expect(compose).toBeHidden({ timeout: 30_000 });
    await finishAnimations(page);
    await fillApprover(detail);
    const approve = detail.getByTestId("approve-btn");
    if (!(await approve.isVisible()) || (await approve.isDisabled())) continue;
    await approve.click();
    const send = detail.getByTestId("send-btn");
    await expect(send).toBeEnabled({ timeout: 30_000 });
    await send.click();
    await expect(detail.getByRole("heading", { name: "Exactly what was sent" })).toBeVisible({ timeout: 60_000 });
    return true;
  }
  return false;
}

test("R8-08: after sending, the heading is past tense and the rows neither collide nor overflow", async ({ page }) => {
  // Sending a letter without a Lob test key is an honest 501; the offline mode (ESCHEAT_OFFLINE=1) is what records "Sent (offline)".
  test.skip(process.env.ESCHEAT_OFFLINE !== "1", "needs ESCHEAT_OFFLINE=1 so a letter can be recorded as sent");
  const sent = await sendAnyLetter(page);
  test.skip(!sent, "no letter can be approved on this database (blocked readiness)");

  const detail = page.getByTestId("approval-detail");
  await expect(detail.getByRole("heading", { name: "Exactly what will be sent" })).toHaveCount(0);
  await expect(detail.getByRole("heading", { name: "What happened" })).toBeVisible();

  for (const width of [1440, 375] as const) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/approvals");
    await finishAnimations(page);
    const handled = page.getByRole("list", { name: "Recently handled" });
    await expect(handled).toBeVisible({ timeout: 30_000 });

    // Each row: the sequence text and the amount column never overlap, and nothing pokes out of the list pane.
    const rows = handled.locator("li");
    const count = await rows.count();
    for (let i = 0; i < count; i++) {
      const row = rows.nth(i);
      const box = await row.boundingBox();
      const amount = await row.getByTestId("row-amount-col").boundingBox();
      const main = await row.locator("[data-testid='row-sequence'], span.truncate").first().boundingBox();
      expect(box).not.toBeNull();
      if (amount) {
        expect(amount.x + amount.width, `row ${i} amount inside the row at ${width}px`).toBeLessThanOrEqual(box!.x + box!.width + 1);
        if (main) expect(main.x + main.width, `row ${i} text stops before the amount at ${width}px`).toBeLessThanOrEqual(amount.x + 1);
      }
    }
    // Claim / report rows (no checkbox) keep their amount inside the list pane too.
    const all = page.getByTestId("row-amount-col");
    const n = await all.count();
    for (let i = 0; i < n; i++) {
      const cell = await all.nth(i).boundingBox();
      const li = await all.nth(i).locator("xpath=ancestor::li[1]").boundingBox();
      expect(cell!.x + cell!.width, `amount ${i} inside its row at ${width}px`).toBeLessThanOrEqual(li!.x + li!.width + 1);
    }

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `${SHOTS}/approvals-after-send-${width}.png`, fullPage: true });
  }

  const { violations } = await new AxeBuilder({ page }).setLegacyMode(true).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
});
