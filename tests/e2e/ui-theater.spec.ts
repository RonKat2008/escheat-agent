/**
 * "Watch it work" (/theater), "ui" group. Creates a REAL run through an existing key-free path (the scripted recovery
 * agent driving the replica portal; CI has no ANTHROPIC_API_KEY and no ESCHEAT_OFFLINE, so a chat answer is not available
 * there) and replays it. The step count is compared against the
 * stored trace from /api/agents/runs/:id, never a hard-coded number. Screenshots land in .data/shots/theater/.
 *   E2E_PORT=3940 E2E_DIR_SUFFIX=theater CI=1 pnpm exec playwright test tests/e2e/ui-theater.spec.ts --project ui
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

test("a scripted agent run is created for real; Agent runs links it to the theater", async ({ page }) => {
  // The recovery agent is scripted without a key (a real browser-agent run against the replica portal); under `next dev`
  // each replica page compiles on first hit. 409 means a run is already active: reuse it, it is just as real.
  test.setTimeout(480_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/runs", { timeout: 90_000 });
  const start = await page.request.post("/api/agents/recover", { data: {} });
  expect([202, 409], await start.text()).toContain(start.status());
  runId = ((await start.json()) as { runId: string }).runId;
  expect(runId).toMatch(/^[0-9a-f-]{36}$/);
  await expect
    .poll(async () => ((await (await page.request.get(`/api/agents/runs/${runId}`)).json()) as { status: string }).status, { timeout: 360_000, intervals: [1000, 2000] })
    .not.toBe("running");

  await page.goto("/runs?agent=recovery_agent", { timeout: 90_000 });
  const watch = page.locator(`a[data-testid="run-watch-link"][href="/theater?run=${runId}"]`);
  await expect(watch).toBeVisible({ timeout: 60_000 });
  const href = (await watch.getAttribute("href")) ?? "";
  expect(href).toMatch(/^\/theater\?run=[0-9a-f-]{36}$/);

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

    // R9-05: the strip counts every classified step (not the played-so-far slice), so it matches the log at any cursor.
    const stageIds = ["ingest", "reconcile", "classify", "rules", "draft", "approval", "execute"];
    for (const s of stageIds) {
      const inLog = await page.locator(`[data-testid="theater-step"][data-stage="${s}"]`).count();
      const label = await page.getByTestId(`stage-${s}`).getByRole("button").getAttribute("aria-label");
      expect(label, `strip count for ${s}`).toContain(`: ${inLog} ${inLog === 1 ? "step" : "steps"}`);
    }

    // R9-05: axe after Play (the hovered Play/Pause button was a serious color-contrast failure).
    await play.click();
    await play.hover();
    expect(await axeBlocking(page)).toEqual([]);
    await play.click();

    // Clicking a log step focuses its node.
    const lastStep = page.getByTestId("theater-step").last();
    await lastStep.click();
    const stage = await lastStep.getAttribute("data-stage");
    await expect(page.getByTestId(`stage-${stage}`)).toHaveAttribute("data-active", "true");
    await page.screenshot({ path: `${SHOTS}/theater-motion-1440.png`, fullPage: true });
  });
});

test.describe("default run and picker (R9-05)", () => {
  test.use({ reducedMotion: "reduce" });

  test("/theater opens the latest filing run (else recovery), keeps ?run= deep links, and the picker reaches every run type", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/theater", { timeout: 90_000 });
    const root = page.getByTestId("theater");
    await expect(root).toBeVisible({ timeout: 60_000 });
    const openedId = (await root.getAttribute("data-run-id")) ?? "";
    const opened = (await (await page.request.get(`/api/agents/runs/${openedId}`)).json()) as { agent: string };
    // The seed always has a filing dry run and the first test made a recovery run, so the default is never a chat.
    expect(["filing_agent", "recovery_agent"]).toContain(opened.agent);

    // A deep link still wins over the default.
    await page.goto(`/theater?run=${runId}`, { timeout: 90_000 });
    await expect(page.getByTestId("theater")).toHaveAttribute("data-run-id", runId);

    // Picker: grouped by agent, filing and recovery first, each group's runs link to /theater?run=.
    const groups = page.getByTestId("theater-picker-group");
    await expect(groups.first()).toBeVisible();
    const agents = await groups.evaluateAll((els) => els.map((e) => e.getAttribute("data-agent")));
    const rank = (a: string | null) => (a === "filing_agent" ? 0 : a === "recovery_agent" ? 1 : 2);
    expect([...agents].sort((a, b) => rank(a) - rank(b))).toEqual(agents);
    for (const href of await page.getByTestId("theater-other-run").evaluateAll((els) => els.map((e) => e.getAttribute("href") ?? ""))) expect(href).toMatch(/^\/theater\?run=[0-9a-f-]{36}$/);
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
