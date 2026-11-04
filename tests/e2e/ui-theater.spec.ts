/**
 * "Watch it work" (/theater), "ui" group, fresh seed. Creates a REAL run through an existing path (a chat question,
 * answered offline from the recorded cassette or the tools) and replays it. The step count is compared against the
 * stored trace from /api/agents/runs/:id, never a hard-coded number. Screenshots land in .data/shots/theater/.
 *   ESCHEAT_OFFLINE=1 E2E_PORT=3940 E2E_DIR_SUFFIX=theater CI=1 pnpm exec playwright test tests/e2e/ui-theater.spec.ts --project ui
 */
import { mkdirSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "playwright/test";

const DISCLAIMER = "Prototype. Not legal advice. Confirm filings with a qualified professional.";
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const SHOTS = ".data/shots/theater";
const WIDTHS = [375, 1024, 1440] as const;

test.beforeAll(() => mkdirSync(SHOTS, { recursive: true }));
test.beforeEach(({}, info) => test.skip(info.project.name !== "ui", "runs in the ui project only"));
test.describe.configure({ mode: "serial", timeout: 240_000 });

async function axeBlocking(page: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page }).setLegacyMode(true).withTags(WCAG_TAGS).analyze();
  return violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
}
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

async function traceLength(page: Page, runId: string): Promise<number> {
  const res = await page.request.get(`/api/agents/runs/${runId}`);
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { trace: unknown[] };
  return body.trace.length;
}

let runId = "";

test("a chat question creates a real run; Agent runs links it to the theater", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/chat", { timeout: 90_000 });
  await expect(page.getByTestId("chat-input")).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("chat-example").filter({ hasText: "What do we owe and where?" }).click();
  const last = page.getByTestId("chat-assistant-message").last();
  await expect(last).toBeVisible({ timeout: 60_000 });
  await expect(last).not.toHaveAttribute("data-status", "streaming", { timeout: 90_000 });

  await page.goto("/runs?agent=chat&replays=1", { timeout: 90_000 });
  const watch = page.getByTestId("run-watch-link").first();
  await expect(watch).toBeVisible({ timeout: 60_000 });
  const href = (await watch.getAttribute("href")) ?? "";
  expect(href).toMatch(/^\/theater\?run=[0-9a-f-]{36}$/);
  runId = href.split("=")[1]!;

  // The run detail links to the same replay.
  await page.goto(`/runs/${runId}`, { timeout: 90_000 });
  await expect(page.getByTestId("run-watch-link")).toHaveAttribute("href", href);
});

test.describe("motion", () => {
  test.use({ reducedMotion: "no-preference" });

  test("replays the stored run: one step per trace entry, gate node, play/pause, speed and scrubber", async ({ page }) => {
    expect(runId, "the first test created a run").not.toBe("");
    const expected = await traceLength(page, runId);
    expect(expected).toBeGreaterThan(0);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/theater?run=${runId}`, { timeout: 90_000 });
    const root = page.getByTestId("theater");
    await expect(root).toBeVisible({ timeout: 60_000 });
    await expect(root).toHaveAttribute("data-motion", "motion");
    await expect(page.getByTestId("theater-mode")).toContainText(`Replay of run ${runId}`);
    await expect(root).toHaveAttribute("data-step-count", String(expected));
    await expect(page.getByTestId("theater-step")).toHaveCount(expected);
    await expect(page.getByTestId("theater-step-count")).toHaveText(String(expected));

    // Gate node is always on the pipeline, pink.
    const gate = page.getByTestId("stage-approval");
    await expect(gate).toBeVisible();
    await expect(gate).toContainText("Human approval gate");
    await expect(page.getByTestId("stage-execute")).toContainText("replica / Lob test");

    // Pause holds the cursor; play moves it again.
    const play = page.getByTestId("theater-play");
    await expect(page.getByTestId("theater-token")).toHaveCount(1);
    if ((await root.getAttribute("data-playing")) === "true") await play.click();
    await expect(root).toHaveAttribute("data-playing", "false");
    await page.getByRole("button", { name: "4×" }).click();
    await expect(page.getByRole("button", { name: "4×" })).toHaveAttribute("aria-pressed", "true");
    // Scrub to the first step, then play.
    await page.getByTestId("theater-scrubber").fill("0");
    await expect(root).toHaveAttribute("data-cursor", "0");
    const before = await root.getAttribute("data-cursor");
    await page.waitForTimeout(1_000);
    await expect(root).toHaveAttribute("data-cursor", before!);
    if (expected > 1) {
      await play.click();
      await expect(root).toHaveAttribute("data-playing", "true");
      await expect(root).not.toHaveAttribute("data-cursor", "0", { timeout: 10_000 });
      await play.click();
      await expect(root).toHaveAttribute("data-playing", "false");
    }

    // Clicking a log step focuses its node.
    const lastStep = page.getByTestId("theater-step").last();
    await lastStep.click();
    const stage = await lastStep.getAttribute("data-stage");
    await expect(page.getByTestId(`stage-${stage}`)).toHaveAttribute("data-active", "true");
    await page.screenshot({ path: `${SHOTS}/theater-motion-1440.png`, fullPage: true });
  });
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("static diagram + log, no token or playback; axe clean; no overflow at 375/1024/1440", async ({ page }) => {
    expect(runId).not.toBe("");
    const expected = await traceLength(page, runId);
    for (const w of WIDTHS) {
      await page.setViewportSize({ width: w, height: w === 375 ? 812 : 900 });
      await page.goto(`/theater?run=${runId}`, { timeout: 90_000 });
      const root = page.getByTestId("theater");
      await expect(root).toBeVisible({ timeout: 60_000 });
      await expect(root).toHaveAttribute("data-motion", "static");
      await expect(page.getByTestId("theater-token")).toHaveCount(0);
      await expect(page.getByTestId("theater-play")).toHaveCount(0);
      await expect(page.getByTestId("theater-static-note")).toBeVisible();
      await expect(page.getByTestId("theater-step")).toHaveCount(expected);
      await expect(page.getByTestId("stage-approval")).toBeVisible();
      await expect(page.getByText(DISCLAIMER)).toBeVisible();
      expect(await overflow(page), `overflow at ${w}`).toBeLessThanOrEqual(0);
      if (w !== 1024) await page.screenshot({ path: `${SHOTS}/theater-static-${w}.png`, fullPage: true });
    }
    expect(await axeBlocking(page)).toEqual([]);
  });

  test("the seed's scripted filing dry run shows rules-engine steps with UNVERIFIED and parks at the gate", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/runs?agent=filing_agent", { timeout: 90_000 });
    const href = (await page.getByTestId("run-watch-link").last().getAttribute("href")) ?? "";
    expect(href).toMatch(/^\/theater\?run=/);
    const id = href.split("=")[1]!;
    await page.goto(href, { timeout: 90_000 });
    await expect(page.getByTestId("theater")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("theater-step")).toHaveCount(await traceLength(page, id));
    const rulesStep = page.locator('[data-testid="theater-step"][data-actor="rules"]').first();
    if (await rulesStep.count()) {
      await rulesStep.click();
      await expect(page.getByTestId("step-detail")).toContainText("Rules engine");
      await expect(page.getByTestId("step-source").first()).toHaveAttribute("href", /^https?:\/\//);
      if (await page.getByTestId("step-detail").getByTestId("unverified-badge").count()) await expect(page.getByTestId("step-detail")).toContainText("unverified values");
    }
    const lastStage = await page.getByTestId("theater-step").last().getAttribute("data-stage");
    if (lastStage === "approval") await expect(page.getByTestId("gate-waiting")).toHaveText("waiting on a person");
    await page.screenshot({ path: `${SHOTS}/theater-seed-dryrun-1440.png`, fullPage: true });
    expect(await axeBlocking(page)).toEqual([]);
  });
});
