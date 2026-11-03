/**
 * Dogfood fix slice C2: reports update in place (F08), submitted reports are locked (F13), filing gate shows the agent's
 * evidence (F21/F22), offline chat reports demo-data drift cleanly (F16).
 *
 * Runs last in the ui group (file name sorts after the others) because it advances the demo clock and files a report;
 * the clock is reset in afterAll. The chat drift test only runs against a server started with ESCHEAT_OFFLINE=1.
 */
import { createHash } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext, type Page } from "playwright/test";
import { finishAnimations } from "./animations";

test.describe.configure({ mode: "serial" });
test.setTimeout(240_000);

const STATES = ["CA", "DE", "TX"] as const;
let state = "";
let reportId = "";
let checksum = "";
let runId = "";

/** Review screenshots (C2_SHOTS=1): the same page at 1440 and 375 into .data/shots/fixC2-<name>-<width>.png. */
async function shot(page: Page, name: string) {
  if (!process.env.C2_SHOTS) return;
  const { mkdirSync } = await import("node:fs");
  mkdirSync(".data/shots", { recursive: true });
  const keep = page.viewportSize();
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 812 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `.data/shots/fixC2-${name}-${width}.png`, fullPage: true });
  }
  if (keep) await page.setViewportSize(keep);
}

async function clock(request: APIRequestContext, body: object) {
  const r = await request.post("/api/clock", { data: body });
  expect(r.status(), await r.text()).toBeLessThan(300);
}

test.beforeAll(async ({ request }) => {
  await clock(request, { action: "advance", days: 900 });
});
test.afterAll(async ({ request }) => {
  await clock(request, { action: "reset" });
});

async function pickState(page: Page): Promise<string> {
  for (const s of STATES) {
    await page.goto(`/reports?state=${s}`);
    await expect(page.getByTestId("report-detail")).toBeVisible();
    if (await page.getByTestId("generate-btn").isEnabled()) return s;
  }
  return "";
}

test("Generate report updates the panel in place, without a reload", async ({ page }) => {
  state = await pickState(page);
  test.skip(!state, "No state has items in To Report");
  await page.evaluate(() => ((window as unknown as { __noReload: number }).__noReload = 1));
  await page.getByTestId("generate-btn").click();
  await expect(async () => {
    await expect(page.getByTestId("download-file")).toBeVisible();
    await expect(page.getByTestId("report-detail")).not.toContainText("Not generated");
    await expect(page.getByTestId("report-detail")).not.toContainText("Never");
  }).toPass({ timeout: 30_000 });
  expect(await page.evaluate(() => (window as unknown as { __noReload?: number }).__noReload)).toBe(1);
  const href = await page.getByTestId("download-file").getAttribute("href");
  reportId = href!.split("/")[3]!;
  await shot(page, "reports-after-generate");
  // The approval is bound to the file's sha256; compute it from the downloaded file like the reviewer's browser would show.
  const file = await page.request.get(href!);
  checksum = createHash("sha256").update(await file.body()).digest("hex");
});

test("the filing gate shows the agent's screenshot and portal summary, and the run links back to Reports", async ({ page, request }) => {
  test.skip(!reportId, "no report");
  const start = await request.post("/api/agents/file", { data: { reportId } });
  expect(start.status(), await start.text()).toBe(202);
  runId = ((await start.json()) as { runId: string }).runId;
  await expect
    .poll(async () => ((await (await request.get(`/api/agents/runs/${runId}`)).json()) as { phase?: string }).phase, { timeout: 120_000, intervals: [500, 1000, 2000] })
    .toBe("awaiting_approval");

  await page.goto(`/reports?state=${state}`);
  const evidence = page.getByTestId("portal-evidence");
  await expect(evidence).toBeVisible();
  await expect(page.getByTestId("portal-summary")).toContainText(/\d+ items?, \$/);
  await expect(page.getByTestId("portal-screenshot")).toBeVisible();
  await expect
    .poll(() => page.getByTestId("portal-screenshot").evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0))
    .toBe(true);

  await shot(page, "filing-panel");

  // F21: the paused banner points at the report gate, and dev websocket blocks are not 40 trace rows.
  await page.goto(`/runs/${runId}`);
  await expect(page.getByRole("link", { name: /Review on Reports/ })).toHaveAttribute("href", `/reports?state=${state}`);
  await expect(page.getByText(/_next\/hmr/)).toHaveCount(0);
});

test("a submitted report is locked: no Regenerate, reconciled against its own snapshot", async ({ page, request }) => {
  test.skip(!runId, "no run");
  const approve = await request.post(`/api/reports/${reportId}/approve`, { data: { approvedBy: "e2e-reviewer", expectedChecksum: checksum } });
  expect(approve.status(), await approve.text()).toBe(201);
  await expect
    .poll(async () => ((await (await request.get(`/api/agents/runs/${runId}`)).json()) as { status?: string }).status, { timeout: 120_000, intervals: [1000, 2000] })
    .toBe("succeeded");

  await page.goto(`/reports?state=${state}`);
  await expect(page.getByTestId("filing-confirmed")).toBeVisible();
  await expect(page.getByRole("button", { name: "Regenerate report" })).toHaveCount(0);
  await expect(page.getByTestId("report-locked")).toBeVisible();
  const detail = page.getByTestId("report-detail");
  await expect(detail).toContainText("Report row and filed file agree");
  await expect(detail).not.toContainText("Items changed since this report was generated");
  await expect(detail).not.toContainText("Items to report now");
});

test("recoveries portal strip shows per-state last-searched after a search", async ({ page, request }) => {
  const start = await request.post("/api/agents/recover", { data: {} });
  expect(start.status(), await start.text()).toBe(202);
  const rid = ((await start.json()) as { runId: string }).runId;
  await expect
    .poll(async () => ((await (await request.get(`/api/agents/runs/${rid}`)).json()) as { status?: string }).status, { timeout: 120_000, intervals: [1000, 2000] })
    .toBe("succeeded");
  await page.goto("/recoveries");
  const strip = page.getByLabel("Replica portals");
  await expect(strip).toBeVisible();
  await expect(strip).not.toContainText("Not searched");
  await expect(strip.getByText(/^Searched /)).toHaveCount(3);
  await shot(page, "recoveries-strip");
});

for (const width of [375, 1024, 1440]) {
  test(`reports and recoveries are axe-clean with no horizontal overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const path of [`/reports?state=${state || "CA"}`, "/recoveries"]) {
      await page.goto(path);
      await expect(page.locator("main h1, main h2").first()).toBeVisible();
      await expect(page.getByLabel(/Loading/)).toHaveCount(0);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${path} overflows at ${width}px`).toBeLessThanOrEqual(0);
      // Rows and panels fade in on first paint; measure contrast once they have settled.
      await finishAnimations(page);
      const axe =await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      const blocking = axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(blocking.map((v) => `${v.id}: ${v.nodes[0]?.target}`)).toEqual([]);
    }
  });
}

test.describe("offline chat", () => {
  test.skip(!process.env.ESCHEAT_OFFLINE, "needs a server started with ESCHEAT_OFFLINE=1");

  test("a recorded prompt over drifted demo data shows one clean message, never a half answer", async ({ page }) => {
    await page.goto("/chat");
    await page.getByTestId("chat-input").fill("What do we owe in unclaimed property, and where?");
    await page.keyboard.press("Enter");
    await expect(page.getByText(/Demo data changed since these answers were recorded/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/nothing is shown rather than/)).toHaveCount(0);
    await expect(page.getByText(/pnpm seed:demo/)).toBeVisible();
    await shot(page, "chat-drift");
  });
});
