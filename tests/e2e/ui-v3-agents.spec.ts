/**
 * DESIGN-V3 slice 7 (agents): /chat (offline replay of a recorded prompt and its card, /chat?q=, offline chips only
 * offer recorded prompts), /runs (a real scripted recovery run's trace, without dev-server noise), /eval (per-slice
 * diagram; no model names under the heuristic, F35), axe, and no horizontal overflow at 375/1024/1440.
 *
 * The offline-replay tests need the server started with ESCHEAT_OFFLINE=1 (it passes through scripts/e2e-server.ts):
 *   ESCHEAT_OFFLINE=1 E2E_PORT=3485 E2E_DIR_SUFFIX=-v3agents CI=1 pnpm exec playwright test tests/e2e/ui-v3-agents.spec.ts --project ui
 * Without it the server is "not configured" and those tests skip with that reason. Writes .data/shots/v3-{chat,runs,eval}-*.png.
 */
import { mkdirSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "playwright/test";
import { answerableOffline } from "../../src/lib/chat/offline-intent";
import { hasRecordedAnswer, recordedNextPrompts } from "../../src/lib/chat/recorded-prompts";

const DISCLAIMER = "Prototype. Not legal advice. Confirm filings with a qualified professional.";
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const SHOTS = ".data/shots";
const WIDTHS = [375, 1024, 1440] as const;
const DEV_NOISE = /\/_next\/|__nextjs|webpack-hmr|hmr\?id=/i;

async function axeBlocking(page: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page }).setLegacyMode(true).withTags(WCAG_TAGS).analyze();
  return violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
}

async function noOverflow(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
}

async function openChat(page: Page, path = "/chat") {
  await page.goto(path, { timeout: 90_000 });
  await expect(page.getByTestId("chat-input")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(DISCLAIMER)).toBeVisible();
}

async function isOffline(page: Page): Promise<boolean> {
  return ((await page.getByTestId("chat-model").textContent()) ?? "").includes("offline");
}

/** Waits for the last answer to finish and asserts it replayed (no error, no "no recorded answer"). */
async function lastAnswerReplayed(page: Page) {
  const last = page.getByTestId("chat-assistant-message").last();
  await expect(last).toHaveAttribute("data-status", "done", { timeout: 60_000 });
  await expect(last.getByTestId("chat-error")).toHaveCount(0);
  await expect(last.getByTestId("chat-offline-badge")).toBeVisible();
  return last;
}

async function settled(page: Page, testId: string) {
  const card = page.getByTestId(testId).last();
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(() =>
      card.evaluate((el) => {
        let o = 1;
        for (let p: HTMLElement | null = el as HTMLElement; p; p = p.parentElement) o *= Number(getComputedStyle(p).opacity);
        return o;
      }),
    )
    .toBe(1);
  return card;
}

test.beforeAll(() => mkdirSync(SHOTS, { recursive: true }));
// The `agents` project's testMatch (/agents\.spec\.ts$/) also matches this file; it belongs to the passcode-gated `ui` group.
test.beforeEach(({}, info) => test.skip(info.project.name !== "ui", "runs in the ui project only"));
// First visits compile routes in `next dev`; give each test room for that.
test.describe.configure({ timeout: 120_000 });

test.describe("chat", () => {
  test("empty state (Ask landing): starter chips from real state; offline, every chip replays or is answered from the data", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openChat(page);
    await expect(page.getByTestId("chat-empty")).toBeVisible();
    const examples = page.getByTestId("chat-example");
    // ASK-MODE §1.4: up to six chips built from real state, always including the two read-only starters.
    expect(await examples.count()).toBeLessThanOrEqual(6);
    await expect(examples.filter({ hasText: "What do we owe and where?" })).toBeVisible();
    if (await isOffline(page)) {
      for (const text of await examples.allInnerTexts()) {
        const prompt = text.split("·")[0]!.trim();
        expect(hasRecordedAnswer([], prompt) || answerableOffline(prompt), prompt).toBe(true);
      }
    }
    await page.screenshot({ path: `${SHOTS}/v3-chat-empty-1440.png` });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.screenshot({ path: `${SHOTS}/v3-chat-empty-375.png` });
  });

  test("offline replay of 'What do we owe in unclaimed property, and where?' renders the exposure card (via /chat?q=)", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const q = "What do we owe in unclaimed property, and where?";
    await openChat(page);
    test.skip(!(await isOffline(page)), "Needs the e2e server started with ESCHEAT_OFFLINE=1");
    await page.goto(`/chat?q=${encodeURIComponent(q)}`);
    await expect(page.getByTestId("chat-user-message").first()).toHaveText(q, { timeout: 30_000 });
    await expect(page).toHaveURL(/\/ask$/);
    const answer = await lastAnswerReplayed(page);
    await expect(answer.getByTestId("chat-tool-trace")).toBeVisible();
    const card = await settled(page, "view-exposure");
    await expect(card.getByTestId("exposure-total")).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/v3-chat-exposure-1440.png` });
    await page.setViewportSize({ width: 375, height: 900 });
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SHOTS}/v3-chat-exposure-375.png` });
  });

  test("/chat?q= sends the question once (prefills the composer when chat cannot send)", async ({ page }) => {
    const q = "Explain check #10482";
    await openChat(page);
    const offline = await isOffline(page);
    await page.goto(`/chat?q=${encodeURIComponent(q)}`);
    await expect(page.getByTestId("chat-input")).toBeVisible({ timeout: 30_000 });
    if (offline) {
      await expect(page.getByTestId("chat-user-message")).toHaveCount(1, { timeout: 30_000 });
      await expect(page.getByTestId("chat-user-message")).toHaveText(q);
      await lastAnswerReplayed(page);
      await settled(page, "view-item-timeline");
      await page.reload();
      await expect(page.getByTestId("chat-user-message")).toHaveCount(1);
    } else {
      await expect(page.getByTestId("chat-input")).toHaveValue(q);
    }
    await expect(page).toHaveURL(/\/ask$/);
  });

  test("offline follow-up chips only offer prompts with a recorded answer, and tapping one replays", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openChat(page);
    test.skip(!(await isOffline(page)), "Needs the e2e server started with ESCHEAT_OFFLINE=1");
    const first = "What do we owe and where?";
    await page.getByTestId("chat-example").filter({ hasText: first }).click();
    await lastAnswerReplayed(page);
    const chips = page.getByTestId("chat-followup");
    await expect(chips.first()).toBeVisible();
    const offered = await chips.allInnerTexts();
    const recorded = recordedNextPrompts([first]);
    for (const c of offered) expect(recorded, `chip "${c}" has no recording`).toContain(c.trim());
    await chips.first().click();
    await lastAnswerReplayed(page);
    await expect(page.getByTestId("chat-user-message")).toHaveCount(2);
  });

  for (const width of WIDTHS) {
    test(`chat @${width}px: no horizontal overflow, axe clean`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
      await openChat(page);
      await noOverflow(page);
      expect(await axeBlocking(page)).toEqual([]);
    });
  }
});

test.describe("runs", () => {
  let runId = "";

  test("a scripted recovery run's trace shows its steps and no dev-server noise", async ({ page }) => {
    // A real (scripted) browser agent drives the replica portal; under `next dev` each replica page compiles on first hit.
    test.setTimeout(480_000);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/runs");
    await expect(page.getByText(DISCLAIMER)).toBeVisible({ timeout: 30_000 });
    const start = await page.request.post("/api/agents/recover", { data: {} });
    expect([202, 409], await start.text()).toContain(start.status());
    runId = ((await start.json()) as { runId: string }).runId;
    // Wait for real steps (the run may still be live: the viewer streams it), not for the whole portal search to end.
    await expect
      .poll(
        async () => {
          const r = (await (await page.request.get(`/api/agents/runs/${runId}`)).json()) as { status: string; trace: unknown[] };
          return r.status !== "running" || (r.trace?.length ?? 0) >= 4;
        },
        { timeout: 360_000, intervals: [1000, 2000] },
      )
      .toBe(true);

    await page.goto("/runs");
    const row = page.locator(`a[href="/runs/${runId}"]`);
    await expect(row).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: `${SHOTS}/v3-runs-list-1440.png` });

    await page.goto(`/runs/${runId}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    const steps = page.getByTestId("trace-steps");
    await expect(steps).toBeVisible({ timeout: 30_000 });
    expect(await steps.locator("li").count()).toBeGreaterThan(0);
    await expect(page.getByTestId("run-mode")).toBeVisible();
    const text = await steps.innerText();
    expect(text).not.toMatch(DEV_NOISE);
    expect(text).not.toContain("[replica-fence]");
    expect(text).not.toContain("Dev noise");
    await page.screenshot({ path: `${SHOTS}/v3-runs-detail-1440.png` });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.screenshot({ path: `${SHOTS}/v3-runs-detail-375.png` });
    await page.goto("/runs");
    await page.screenshot({ path: `${SHOTS}/v3-runs-list-375.png` });
  });

  for (const width of WIDTHS) {
    test(`runs @${width}px: list and detail have no horizontal overflow, axe clean`, async ({ page }) => {
      test.setTimeout(240_000);
      await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
      await page.goto("/runs");
      await expect(page.getByText(DISCLAIMER)).toBeVisible({ timeout: 30_000 });
      await noOverflow(page);
      expect(await axeBlocking(page)).toEqual([]);
      const first = page.locator('a[href^="/runs/"]').first();
      if (await first.count()) {
        await page.goto((await first.getAttribute("href"))!, { waitUntil: "domcontentloaded", timeout: 90_000 });
        await expect(page.getByTestId("trace-steps")).toBeVisible({ timeout: 30_000 });
        await noOverflow(page);
        expect(await axeBlocking(page)).toEqual([]);
      }
    });
  }
});

test.describe("eval", () => {
  test("renders the stats, the per-slice diagram, and no model names under the heuristic (F35)", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/eval");
    await expect(page.getByText(DISCLAIMER)).toBeVisible({ timeout: 30_000 });
    const method = page.getByTestId("eval-method");
    if ((await method.count()) === 0) {
      await expect(page.getByText("No eval run yet")).toBeVisible();
      return;
    }
    await expect(page.getByTestId("eval-overall")).toBeAttached();
    const slices = page.getByTestId("eval-slices");
    await expect(slices).toBeVisible();
    await expect(slices.locator("[data-slice]")).toHaveCount(3);
    if ((await method.getAttribute("data-method")) === "heuristic") {
      await expect(page.getByText("Worker model")).toHaveCount(0);
      await expect(page.getByText("Orchestrator model")).toHaveCount(0);
    }
    await page.screenshot({ path: `${SHOTS}/v3-eval-1440.png`, fullPage: true });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.screenshot({ path: `${SHOTS}/v3-eval-375.png`, fullPage: true });
  });

  for (const width of WIDTHS) {
    test(`eval @${width}px: no horizontal overflow, axe clean`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
      await page.goto("/eval");
      await expect(page.getByText(DISCLAIMER)).toBeVisible({ timeout: 30_000 });
      await noOverflow(page);
      expect(await axeBlocking(page)).toEqual([]);
    });
  }
});
