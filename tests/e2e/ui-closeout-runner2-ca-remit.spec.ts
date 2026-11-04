/**
 * R7-01: California's two-stage cycle in the close-out runner, end to end on the seeded data.
 *  - Nov 1, 2026: the CA notice report is filed (by ui-closeout-runner.spec.ts on the shared server, or here when this
 *    spec runs alone). The remit stage is a scheduled step: "Notice filed <date> · Remit report due Jun 15, 2027
 *    (UNVERIFIED)", with no Record remittance anywhere.
 *  - Demo clock -> Jun 20, 2027: the runner opens the remit stage for Callum Whitlock ($1,574.10): generate the remit
 *    report -> validate -> approve anyway (typed name) -> the filing agent files it on the replica portal -> receipt
 *    -> Record remittance. The item leaves the dashboard's overdue list; the next notice cycle stays To Report.
 *  - axe serious/critical clean and no horizontal overflow at 375/1024/1440 on the remit stage.
 * RESIDUE: a CA remit report is filed and Callum is Remitted. The clock is reset to the anchor date afterwards.
 * Shots (relative): .data/shots/r8-closeout/ca-remit-<step>-<width>.png
 */
import { mkdirSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "playwright/test";
import type { RunnerView } from "../../src/lib/close-out/runner-model";
import { finishAnimations } from "./animations";
import { fillApprover } from "./approver";

const ST = "CA";
const SHOTS = ".data/shots/r8-closeout";
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const DISCLAIMER = "Prototype. Not legal advice. Confirm filings with a qualified professional.";
const REMIT_DAY = "2027-06-20";
const CALLUM_CENTS = 157_410;

test.describe.configure({ mode: "serial", timeout: 600_000 });
test.beforeAll(() => mkdirSync(SHOTS, { recursive: true }));
test.afterAll(async ({ request }) => {
  await request.post("/api/clock", { data: { action: "reset" } });
});

const step = (page: Page, id: string) => page.locator(`[data-testid="runner-step"][data-step-id="${id}"]`);

async function runnerJson(page: Page): Promise<RunnerView> {
  const res = await page.request.get(`/api/close-out/runner?state=${ST}`);
  expect(res.status(), await res.text()).toBe(200);
  return ((await res.json()) as { runner: RunnerView }).runner;
}

async function openRunner(page: Page) {
  await page.goto(`/close-out/${ST}`, { timeout: 90_000 });
  await expect(page.getByTestId("close-out-runner")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(DISCLAIMER)).toBeVisible();
}

async function shots(page: Page, name: string) {
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({ path: `${SHOTS}/ca-remit-${name}-${width}.png`, fullPage: true, animations: "disabled" });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
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

/** Generate -> approve (anyway, under a typed name) -> run the filing agent on the replica portal -> receipt. */
async function fileThroughRunner(page: Page) {
  const gen = step(page, "report_generate");
  if ((await gen.getAttribute("data-tone")) === "machine") await gen.getByTestId("runner-action").click();
  await expect(gen).toHaveAttribute("data-tone", "done", { timeout: 90_000 });
  const approve = step(page, "report_approve");
  await expect(approve).toHaveAttribute("data-tone", "human");
  await fillApprover(approve);
  const ack = approve.getByTestId("runner-ack-box");
  if ((await ack.count()) > 0) {
    await expect(approve.getByTestId("runner-action")).toHaveText("Approve anyway");
    await expect(approve.getByTestId("runner-action")).toBeDisabled();
    await ack.check();
  }
  await approve.getByTestId("runner-action").click();
  await expect(approve).toHaveAttribute("data-tone", "done", { timeout: 60_000 });
  const submit = step(page, "report_submit");
  await expect(submit.getByTestId("runner-action")).toHaveAttribute("data-op", "run_filing");
  await submit.getByTestId("runner-action").click();
  await expect(submit).toHaveAttribute("data-tone", "done", { timeout: 180_000 });
  await expect(page.getByTestId("runner-receipt").first()).toBeVisible({ timeout: 60_000 });
}

test("CA notice -> clock jump -> remit report -> Record remittance clears Callum Whitlock", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openRunner(page);

  // 1. The notice stage is filed (here, when this spec runs alone on a fresh seed).
  let v = await runnerJson(page);
  if (!v.receipt && !v.stageName) {
    await fileThroughRunner(page);
    v = await runnerJson(page);
  }
  expect(v.receipt).toMatchObject({ stage: "notice", stageRemits: false });
  const remitStep = step(page, "remit");
  await expect(remitStep).toHaveAttribute("data-tone", "not_needed");
  await expect(remitStep.getByTestId("runner-step-detail")).toContainText(/^Scheduled\. Notice filed \w{3} \d{1,2}, 2026 · Remit report due Jun 15, 2027 \(UNVERIFIED\)/);
  await expect(remitStep.getByTestId("runner-action")).toHaveCount(0);
  await expect(page.getByTestId("runner-receipt").getByTestId("receipt-next-stage")).toContainText("Remit report due Jun 15, 2027");
  await shots(page, "1-notice-filed");

  // Reports: the remit stage is scheduled; nothing can be remitted yet.
  await page.goto(`/reports?state=${ST}`, { timeout: 90_000 });
  await expect(page.getByTestId("reports-remit-stage")).toHaveAttribute("data-open", "false", { timeout: 60_000 });
  await expect(page.getByTestId("reports-remit-stage")).toContainText("Remit report due Jun 15, 2027 (UNVERIFIED)");
  await expect(page.getByTestId("record-remittance")).toHaveCount(0);

  // 2. Jump the demo clock past the remit report's date.
  const jump = await page.request.post("/api/clock", { data: { action: "advance_to", date: REMIT_DAY } });
  expect(jump.status(), await jump.text()).toBeLessThan(300);
  await page.goto("/dashboard", { timeout: 90_000 });
  await expect(page.getByTestId("overdue-panel")).toContainText(/Callum Whitlock/i, { timeout: 60_000 });

  // 3. The runner opens the remit stage for Callum, ahead of the next notice cycle.
  await openRunner(page);
  await expect(page.getByTestId("runner-stage")).toHaveAttribute("data-stage", "remit");
  v = await runnerJson(page);
  expect(v.stageName).toBe("remit");
  expect([v.itemCount, v.atStakeCents]).toEqual([1, CALLUM_CENTS]);
  const gen = step(page, "report_generate");
  await expect(gen.getByTestId("runner-action")).toHaveText("Generate remit report");
  await expect(gen.getByTestId("runner-step-detail")).toContainText(/Notice filed \w{3} \d{1,2}, 2026 · Remit report due Jun 15, 2027 \(UNVERIFIED\)/);
  await expect(gen.getByTestId("runner-step-late")).toContainText("Late · due Jun 15, 2027, 5 days ago");
  for (const width of [375, 1024, 1440] as const) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `overflow at ${width}`).toBeLessThanOrEqual(0);
    expect(await axeBlocking(page), `axe at ${width}`).toEqual([]);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await shots(page, "2-remit-open");

  // 4. Generate, approve anyway, file on the replica portal.
  await fileThroughRunner(page);
  v = await runnerJson(page);
  expect(v.receipt).toMatchObject({ stage: "remit", stageRemits: true, itemCount: 1, totalCents: CALLUM_CENTS, frozen: true, reportDue: "2027-06-15", daysLate: 5 });
  const receipt = page.getByTestId("runner-receipt").first();
  await expect(receipt).toContainText("remit report filed on the replica portal");
  await expect(receipt.getByTestId("receipt-to-remit")).toContainText("$1,574.10");
  const remit = step(page, "remit");
  await expect(remit).toHaveAttribute("data-tone", "human");
  await expect(remit.getByTestId("runner-action")).toHaveAttribute("data-op", "record_remittance");
  await shots(page, "3-remit-filed");
  const frozen = { ...v.receipt, remittance: null };

  // 5. Record remittance (a person, a date, a reference; nothing is paid from the app).
  await fillApprover(remit);
  await remit.getByTestId("runner-remit-ref").fill("WIRE-CA-REMIT");
  await remit.getByTestId("runner-action").click();
  await expect(page.getByTestId("runner-message")).toContainText("recorded the remittance", { timeout: 60_000 });
  v = await runnerJson(page);
  // The runner moves on to the next notice cycle and keeps the remit stage's receipt, frozen, plus the remittance.
  expect(v.stageName).toBeNull();
  expect(v.priorReceipt).toMatchObject({ stage: "remit", remittance: { totalCents: CALLUM_CENTS, reference: "WIRE-CA-REMIT" } });
  expect({ ...v.priorReceipt, remittance: null }).toEqual(frozen);
  await expect(page.getByTestId("runner-receipt").getByTestId("receipt-remitted")).toContainText("WIRE-CA-REMIT");
  await expect(page.getByTestId("runner-receipt").getByTestId("receipt-interest")).not.toContainText("accruing");
  await shots(page, "4-remitted");

  // 6. Callum is no longer overdue anywhere; Reports offers no remittance for CA.
  await page.goto("/dashboard", { timeout: 90_000 });
  await expect(page.getByRole("region", { name: "Total exposure" })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator("main")).not.toContainText(/Callum Whitlock/i);
  await page.goto(`/reports?state=${ST}`, { timeout: 90_000 });
  await expect(page.getByTestId("report-detail")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("record-remittance")).toHaveCount(0);
  await expect(page.getByTestId("reports-remit-stage")).toHaveCount(0);
});
