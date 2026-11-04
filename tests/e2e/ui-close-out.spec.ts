import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "playwright/test";
import { closeStepHref } from "../../src/components/chat/views/close-plan";
import type { ClosePlan } from "../../src/lib/chat/ui-types";

/**
 * "Close out <STATE>": the ClosePlan card, its gates and its two safe buttons. The e2e server has no model key, so the
 * card is rendered through the real chat UI from a restored conversation whose tool result is the REAL plan from
 * GET /api/close-out (same builder as the plan_close_out tool). Nothing here is mocked except the model's turn.
 * Runs in the passcode-gated "ui" group. Deterministic waits only.
 */
const WIDTHS = [375, 1024, 1440] as const;
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const DISCLAIMER = "Prototype. Not legal advice. Confirm filings with a qualified professional.";
const STATES = ["CA", "DE", "TX"] as const;
const PROMPT: Record<string, string> = { CA: "Close out California for this cycle", DE: "Close out Delaware for this cycle", TX: "Close out Texas for this cycle" };

async function fetchPlan(page: Page, state: string): Promise<ClosePlan> {
  const res = await page.request.get(`/api/close-out?state=${state}`);
  expect(res.status(), await res.text()).toBe(200);
  return ((await res.json()) as { plan: ClosePlan }).plan;
}

/** Restores a one-turn conversation whose tool card is the given plan, then opens /chat. */
async function openPlanInChat(page: Page, plan: ClosePlan) {
  const turns = [
    { id: "u1", role: "user", text: PROMPT[plan.state] },
    {
      id: "a1",
      role: "assistant",
      status: "done",
      parts: [
        { type: "tool", id: "t1", name: "plan_close_out", label: "Building the close-out plan", status: "done", summary: `${plan.state} close-out: ${plan.done} of ${plan.total} done`, ui: { kind: "close_plan", props: { plan } } },
        { type: "text", text: `Here is the ${plan.stateName} close-out plan.` },
      ],
    },
  ];
  await page.addInitScript((json) => {
    if (sessionStorage.getItem("e2e-close-seeded")) return;
    sessionStorage.setItem("e2e-close-seeded", "1");
    sessionStorage.setItem("escheat.chat.v1", json);
  }, JSON.stringify(turns));
  await page.goto("/chat");
  const card = page.getByTestId("view-close-plan");
  await expect(card).toBeVisible({ timeout: 30_000 });
  // The chat fades each card in (opacity, kept under reduced motion); measure contrast and visibility after it settles.
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

async function shots(page: Page, name: string) {
  if (!process.env.CLOSE_SHOTS) return;
  const keep = page.viewportSize();
  for (const width of [1440, 375]) {
    // Tall enough that the whole card fits in the chat's scroll area, so the shot is the card alone.
    await page.setViewportSize({ width, height: width === 1440 ? 2200 : 2600 });
    const card = page.getByTestId("view-close-plan");
    await expect(card).toBeVisible();
    await card.scrollIntoViewIfNeeded();
    await card.screenshot({ path: `.data/shots/close-${name}-${width}.png`, animations: "disabled" });
  }
  if (keep) await page.setViewportSize(keep);
}

test.describe("close-out entry points", () => {
  test("the empty chat offers Close out CA/DE/TX chips next to the examples", async ({ page }) => {
    await page.goto("/chat");
    const chips = page.getByTestId("chat-close-out-chip");
    await expect(chips).toHaveCount(3);
    await expect(chips.nth(0)).toHaveAccessibleName(/^Close out CA ?: Close out California for this cycle$/);
    await expect(page.getByTestId("chat-example")).toHaveCount(6);
  });

  test("Reports' Plan close-out opens chat with the prompt prefilled (never auto-sent)", async ({ page }) => {
    await page.goto("/reports?state=DE");
    const link = page.getByTestId("plan-close-out");
    await expect(link).toHaveAttribute("href", `/chat?ask=${encodeURIComponent(PROMPT.DE!)}`);
    await link.click();
    await expect(page).toHaveURL(/\/chat$/, { timeout: 30_000 });
    await expect(page.getByTestId("chat-input")).toHaveValue(PROMPT.DE!);
    await expect(page.getByTestId("chat-user-message")).toHaveCount(0);
  });
});

test.describe("ClosePlan card", () => {
  test.use({ reducedMotion: "reduce" });

  test("renders every step from the records, with progress and money", async ({ page }) => {
    const plan = await fetchPlan(page, "CA");
    const card = await openPlanInChat(page, plan);
    await expect(card.getByRole("heading", { name: "Close out California" })).toBeVisible();
    await expect(card.getByTestId("close-progress")).toHaveAttribute("data-done", String(plan.done));
    await expect(card.getByTestId("close-progress")).toContainText(`${plan.done} of ${plan.total} ${plan.total === 1 ? "step" : "steps"} done`);
    await expect(card.getByRole("progressbar")).toHaveAttribute("aria-valuenow", String(plan.done));
    const steps = card.getByTestId("close-step");
    await expect(steps).toHaveCount(plan.total);
    for (const [i, s] of plan.steps.entries()) {
      await expect(steps.nth(i)).toHaveAttribute("data-step-id", s.id);
      await expect(steps.nth(i)).toHaveAttribute("data-status", s.missed ? "missed" : s.notNeeded ? "not_needed" : s.status);
      await expect(steps.nth(i)).toContainText(s.title);
      await expect(steps.nth(i)).toContainText(s.detail);
    }
    await expect(page.locator("#main ~ footer")).toContainText(DISCLAIMER);
    await shots(page, "fresh");
  });

  test("every step links to the right gate, and irreversible steps never get a button", async ({ page }) => {
    const plan = await fetchPlan(page, "CA");
    const card = await openPlanInChat(page, plan);
    const allowed: Record<string, RegExp> = {
      letters_draft: /^\/items\?state=CA&status=dd_pending$/,
      letters_approve: /^\/approvals$/,
      letters_send: /^\/approvals$/,
      rules_verify: /^\/rules\?state=CA$/,
      report_generate: /^\/reports\?state=CA$/,
      report_approve: /^\/(approvals(\?sel=r%3A[0-9a-f-]{36})?|reports\?state=CA)$/,
      report_submit: /^\/(reports\?state=CA|runs\/[0-9a-f-]{36})$/,
      remit: /^\/items\?state=CA&status=reported$/,
    };
    for (const s of plan.steps) {
      const row = card.locator(`[data-step-id="${s.id}"]`);
      expect(s.href).toMatch(allowed[s.id]!);
      if (s.status !== "done") await expect(row.getByTestId("close-step-link")).toHaveAttribute("href", closeStepHref(s, "CA"));
      const irreversible = !["letters_draft", "report_generate"].includes(s.id);
      if (irreversible) await expect(row.getByTestId("close-step-action")).toHaveCount(0);
      await expect(row.getByRole("button", { name: /approve|send|submit|file|pay/i })).toHaveCount(0);
    }
    const rules = card.locator('[data-step-id="rules_verify"]').getByTestId("close-step-link");
    if (await rules.count()) {
      await rules.click();
      await expect(page).toHaveURL(/\/rules\?state=CA$/, { timeout: 30_000 });
    }
  });

  test("Refresh re-reads the plan from the records", async ({ page }) => {
    const plan = await fetchPlan(page, "TX");
    const card = await openPlanInChat(page, plan);
    await card.getByTestId("close-refresh").click();
    await expect(card.getByTestId("close-message")).toContainText(/Refreshed: \d+ of \d+ steps done/, { timeout: 30_000 });
  });

  test("a safe step runs from the card and the card updates live", async ({ page }) => {
    let plan: ClosePlan | null = null;
    for (const st of STATES) {
      const p = await fetchPlan(page, st);
      if (p.steps.some((s) => s.action)) {
        plan = p;
        break;
      }
    }
    test.skip(!plan, "No state has a step chat can run");
    const card = await openPlanInChat(page, plan!);
    await shots(page, "before-action");
    const step = plan!.steps.find((s) => s.action)!;
    const row = card.locator(`[data-step-id="${step.id}"]`);
    await row.getByTestId("close-step-action").click();
    await expect(card.getByTestId("close-message")).toContainText(/nothing was (sent|filed)|validation|already|No letters/i, { timeout: 60_000 });
    const after = await fetchPlan(page, plan!.state);
    await expect(card.getByTestId("close-progress")).toHaveAttribute("data-done", String(after.done));
    await expect(row).toHaveAttribute("data-status", after.steps.find((s) => s.id === step.id)!.status);
    expect(after.steps.find((s) => s.id === step.id)!.status).not.toBe("ready");
    await shots(page, "partly-done");
  });

  test("reduced motion: every step and node is fully visible with no looping animation", async ({ page }) => {
    const card = await openPlanInChat(page, await fetchPlan(page, "CA"));
    const steps = card.getByTestId("close-step");
    await expect(steps.first()).toBeVisible();
    const report = await card.evaluate((el) =>
      [...el.querySelectorAll<HTMLElement>("[data-testid=close-step], [data-testid=close-step] span")].map((n) => {
        const cs = getComputedStyle(n);
        let o = 1;
        for (let p: HTMLElement | null = n; p && p !== el; p = p.parentElement) o *= Number(getComputedStyle(p).opacity);
        return { o, anim: cs.animationName, infinite: cs.animationIterationCount === "infinite" };
      }),
    );
    expect(report.every((r) => r.o > 0.99)).toBe(true);
    expect(report.filter((r) => r.infinite && r.anim !== "none")).toEqual([]);
  });

  for (const width of WIDTHS) {
    test(`no horizontal overflow and axe serious/critical clean at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      const card = await openPlanInChat(page, await fetchPlan(page, "CA"));
      await expect(card.getByTestId("close-step").first()).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
      expect(await card.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
      const { violations } = await new AxeBuilder({ page }).include('[data-testid="view-close-plan"]').withTags(WCAG_TAGS).analyze();
      const blocking = violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).join(", ")})`);
      expect(blocking, `close plan @ ${width}px`).toEqual([]);
      const page_ = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
      expect(page_.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id), `chat page @ ${width}px`).toEqual([]);
    });
  }

  test("the API refuses an unsupported state", async ({ page }) => {
    const res = await page.request.get("/api/close-out?state=NY");
    expect(res.status()).toBe(400);
  });
});
