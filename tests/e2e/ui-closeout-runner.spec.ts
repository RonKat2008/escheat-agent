/**
 * The close-out runner (/close-out/[state], round-4 opportunity #2): one page that walks a state's 8 close-out steps,
 * each button running the step through the existing server paths, ending on a replica-portal receipt.
 *  - reachable from Reports ("Close out XX") and from the chat ClosePlan card ("Open close-out runner");
 *  - end to end on the seeded data: generate + validate -> a person approves under a TYPED name (the field starts
 *    empty; the server refuses an approval without a name or with the wrong checksum) -> the filing agent drives the
 *    replica portal (live filmstrip) -> receipt with confirmation, money, lateness, interest and the evidence pack;
 *  - axe serious/critical clean and no horizontal overflow at 375/1024/1440; reduced motion leaves nothing hidden.
 *
 * State: CLOSEOUT_STATE (default CA). CA is filed here rather than TX because later ui specs (late money, overdue,
 * dashboard) assert on the seeded late TX report. No rule approval is needed for CA, so nothing has to be withdrawn.
 * RESIDUE on this server's database (cannot be undone through the app; filing is irreversible by design): the CA
 * report is submitted (replica confirmation), its To Report item(s) become "reported", one submit_report approval is
 * consumed. CA letter drafts are left untouched. Shots: .data/shots/closeout-runner-<state>-{1440,375}[-done].png
 */
import { mkdirSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "playwright/test";
import type { ClosePlan } from "../../src/lib/chat/ui-types";
import type { RunnerView } from "../../src/lib/close-out/runner-model";
import { pdfPageTexts } from "../../src/lib/reports/__fixtures__/pdf";

const ST = (process.env.CLOSEOUT_STATE ?? "CA").toUpperCase();
const NAMES: Record<string, string> = { CA: "California", DE: "Delaware", TX: "Texas" };
const DISCLAIMER = "Prototype. Not legal advice. Confirm filings with a qualified professional.";
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const SHOTS = process.env.CLOSEOUT_SHOTS_DIR ?? ".data/shots";
const WIDTHS = [375, 1024, 1440] as const;
const APPROVER = "E2E Closer";

test.describe.configure({ mode: "serial", timeout: 300_000 });
test.beforeAll(() => mkdirSync(SHOTS, { recursive: true }));

async function runnerJson(page: Page): Promise<RunnerView> {
  const res = await page.request.get(`/api/close-out/runner?state=${ST}`);
  expect(res.status(), await res.text()).toBe(200);
  return ((await res.json()) as { runner: RunnerView }).runner;
}

async function openRunner(page: Page) {
  await page.goto(`/close-out/${ST}`, { timeout: 90_000 });
  await expect(page.getByTestId("close-out-runner")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("heading", { level: 1, name: `Close out ${NAMES[ST]}` })).toBeVisible();
}

const step = (page: Page, id: string) => page.locator(`[data-testid="runner-step"][data-step-id="${id}"]`);

async function axeBlocking(page: Page): Promise<string[]> {
  // Measure contrast after the one-shot entrance animations settle (looping pulses are skipped).
  await page.evaluate(() =>
    Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => undefined))),
  );
  const { violations } = await new AxeBuilder({ page }).setLegacyMode(true).withTags(WCAG_TAGS).analyze();
  return violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
}
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

async function shot(page: Page, name: string) {
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({ path: `${SHOTS}/closeout-runner-${ST}-${width}${name}.png`, fullPage: true, animations: "disabled" });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
}

test("Reports opens the runner for the selected state", async ({ page }) => {
  await page.goto(`/reports?state=${ST}`, { timeout: 90_000 });
  const link = page.getByTestId("open-close-out-runner");
  await expect(link).toHaveAttribute("href", `/close-out/${ST}`);
  await link.click();
  await expect(page).toHaveURL(new RegExp(`/close-out/${ST}$`), { timeout: 60_000 });
  await expect(page.getByTestId("close-out-runner")).toHaveAttribute("data-state", ST);
});

test("the chat ClosePlan card links to the runner (tool output unchanged)", async ({ page }) => {
  const res = await page.request.get(`/api/close-out?state=${ST}`);
  expect(res.status()).toBe(200);
  const plan = ((await res.json()) as { plan: ClosePlan }).plan;
  const turns = [
    { id: "u1", role: "user", text: `Close out ${NAMES[ST]} for this cycle` },
    {
      id: "a1",
      role: "assistant",
      status: "done",
      parts: [{ type: "tool", id: "t1", name: "plan_close_out", label: "Building the close-out plan", status: "done", summary: `${ST} close-out`, ui: { kind: "close_plan", props: { plan } } }],
    },
  ];
  await page.addInitScript((json) => {
    if (sessionStorage.getItem("e2e-runner-seeded")) return;
    sessionStorage.setItem("e2e-runner-seeded", "1");
    sessionStorage.setItem("escheat.chat.v1", json);
  }, JSON.stringify(turns));
  await page.goto("/chat");
  const card = page.getByTestId("view-close-plan");
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card.getByTestId("close-open-runner")).toHaveAttribute("href", `/close-out/${ST}`);
});

test("rejects an unsupported state", async ({ page }) => {
  expect((await page.request.get("/api/close-out/runner?state=NY")).status()).toBe(400);
  await page.goto("/close-out/NY");
  // notFound() inside the streamed Suspense boundary: the not-found UI renders and no runner is shown.
  await expect(page.getByRole("heading", { name: /does not exist|not found/i }).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("close-out-runner")).toHaveCount(0);
});

test(`closes out ${ST} end to end through the replica portal`, async ({ page }) => {
  const started = Date.now();
  await page.setViewportSize({ width: 1440, height: 900 });
  await openRunner(page);
  await expect(page.getByText(DISCLAIMER)).toBeVisible();
  const before = await runnerJson(page);
  await expect(page.getByTestId("runner-progress")).toHaveAttribute("data-done", String(before.done));
  await expect(page.getByTestId("runner-step")).toHaveCount(8);
  await shot(page, "");

  // 1. Generate + validate (a machine step: files nothing). On the shared ui server an earlier spec may already have
  // generated this state's file (ui-close-out runs the chat card's safe step); then the step is already done.
  const gen = step(page, "report_generate");
  if (before.steps.find((s) => s.id === "report_generate")!.tone === "machine") {
    await expect(gen).toHaveAttribute("data-tone", "machine");
    await gen.getByTestId("runner-action").click();
  }
  await expect(gen).toHaveAttribute("data-tone", "done", { timeout: 90_000 });
  await expect(gen.getByTestId("runner-step-detail")).toContainText(/Validator: no errors/);

  // 2. A person approves: pink, the name field starts EMPTY and the button stays disabled until a name is typed.
  const approve = step(page, "report_approve");
  await expect(approve).toHaveAttribute("data-tone", "human");
  const button = approve.getByTestId("runner-action");
  await expect(approve.getByTestId("runner-approver")).toHaveValue("");
  await expect(button).toBeDisabled();
  // The filing agent cannot be started from the runner before the approval.
  await expect(step(page, "report_submit").getByTestId("runner-action")).toHaveCount(0);

  // Server-enforced: no name, or a checksum the reviewer did not see, is refused (nothing is auto-approved).
  const mid = await runnerJson(page);
  const ctl = mid.steps.find((s) => s.id === "report_approve")!.control;
  expect(ctl?.op).toBe("approve_report");
  const reportId = ctl && ctl.op === "approve_report" ? ctl.reportId : "";
  const checksum = ctl && ctl.op === "approve_report" ? ctl.expectedChecksum : "";
  expect((await page.request.post(`/api/reports/${reportId}/approve`, { data: { approvedBy: "", expectedChecksum: checksum } })).status()).toBe(400);
  expect((await page.request.post(`/api/reports/${reportId}/approve`, { data: { approvedBy: APPROVER, expectedChecksum: "0".repeat(64) } })).status()).toBe(409);
  expect((await runnerJson(page)).steps.find((s) => s.id === "report_approve")!.tone).toBe("human");

  await approve.getByTestId("runner-approver").fill(APPROVER);
  await expect(button).toBeEnabled();
  await button.click();
  await expect(approve).toHaveAttribute("data-tone", "done", { timeout: 60_000 });
  await expect(approve.getByTestId("runner-step-detail")).toContainText(`Approved by ${APPROVER}`);

  // 3. The filing agent drives the replica portal; its progress streams into the filmstrip.
  const submit = step(page, "report_submit");
  await expect(submit.getByTestId("runner-action")).toHaveAttribute("data-op", "run_filing");
  await submit.getByTestId("runner-action").click();
  const film = submit.getByTestId("filmstrip");
  await expect(film).toBeVisible({ timeout: 30_000 });
  await expect(film.getByTestId("filmstrip-step").first()).toBeVisible({ timeout: 60_000 });

  // 4. Receipt.
  const receipt = page.getByTestId("runner-receipt");
  await expect(receipt).toBeVisible({ timeout: 180_000 });
  await expect(submit).toHaveAttribute("data-tone", "done");
  await expect(film).toHaveAttribute("data-run-status", "succeeded");
  expect(await film.getByTestId("filmstrip-shot").count()).toBeGreaterThan(0);
  const confirmation = (await receipt.getByTestId("receipt-confirmation").innerText()).trim();
  expect(confirmation.length).toBeGreaterThan(3);
  const after = await runnerJson(page);
  expect(after.receipt?.confirmation).toBe(confirmation);
  await expect(receipt.getByTestId("receipt-filed")).toContainText(/\d+ items?, \$[\d,]+\.\d{2}/);
  // Interest is the engine's figure (UNVERIFIED stays) or an honest UNKNOWN / none; never a guessed rate.
  await expect(receipt.getByTestId("receipt-interest")).toContainText(/accruing|UNKNOWN|nothing in this filing is late/);
  if (after.receipt?.interest.status === "ok" && !after.receipt.interest.verified) await expect(receipt.getByTestId("receipt-interest").getByTestId("unverified-badge")).toBeVisible();
  await expect(receipt.getByTestId("receipt-evidence")).toHaveAttribute("href", `/api/reports/${reportId}/evidence`);
  const pdf = await page.request.get(`/api/reports/${reportId}/evidence`);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toContain("application/pdf");
  // R5-12: the pack carries the receipt's filing facts.
  const cover = (await pdfPageTexts(new Uint8Array(await pdf.body())))[0] ?? "";
  expect(cover).toContain(`Replica confirmation: ${confirmation}`);
  expect(cover).toMatch(/Approved by: \S/);
  expect(cover).toContain("Late interest disclosed:");
  expect(after.done).toBeGreaterThan(before.done);
  await expect(page.getByTestId("runner-progress")).toHaveAttribute("data-done", String(after.done));
  console.log(`[closeout-runner] ${ST} closed out in ${Math.round((Date.now() - started) / 1000)}s, confirmation ${confirmation}`);
  await shot(page, "-done");
});

test("axe clean and no horizontal overflow at 375/1024/1440", async ({ page }) => {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
    await openRunner(page);
    expect(await overflow(page), `overflow @${width}`).toBeLessThanOrEqual(0);
    expect(await axeBlocking(page), `axe @${width}`).toEqual([]);
  }
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });
  test("every step is fully visible and nothing animates", async ({ page }) => {
    await openRunner(page);
    const report = await page.getByTestId("close-out-runner").evaluate((root) =>
      [...root.querySelectorAll<HTMLElement>("[data-testid=runner-step], [data-testid=runner-receipt], .co-pop, .co-slide, .co-rise, .co-fill")].map((n) => {
        const cs = getComputedStyle(n);
        return { o: Number(cs.opacity), anim: cs.animationName, dur: cs.transitionDuration };
      }),
    );
    expect(report.every((r) => r.o > 0.99)).toBe(true);
    expect(report.filter((r) => r.anim !== "none")).toEqual([]);
  });
});
