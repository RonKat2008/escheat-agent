/**
 * Dogfood fix lane C1 (ui group): items sort/filter URLs, no raw SQL or ZodError on screen, the offline send reaching a
 * terminal state, keyboard focus in the items drawer and approvals, dashboard honesty, palette Enter, axe and overflow.
 * Tests run in order; the offline send needs ESCHEAT_OFFLINE=1 and is skipped otherwise.
 */
import { mkdirSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "playwright/test";
import { finishAnimations } from "./animations";
import { fillApprover } from "./approver";

const SHOTS = ".data/shots";
const DISCLAIMER = "Prototype. Not legal advice. Confirm filings with a qualified professional.";
const OFFLINE = process.env.ESCHEAT_OFFLINE === "1";
const parseUsd = (t: string) => Math.round(Number(t.replace(/[^0-9.]/g, "")) * 100);

const noRaw = async (page: Page) => {
  const body = await page.locator("body").innerText();
  expect(body).not.toMatch(/Failed query|ZodError|invalid_value|params:|select .* from|"code":/i);
};

async function noOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

async function expectAxeClean(page: Page) {
  // Rows and Money flow cards fade in on first paint; measure contrast once finite animations have settled.
  await finishAnimations(page);
  // Legacy mode scans each frame in place. The default opens a helper page to merge iframe results, and on CI that
  // newPage call intermittently hangs on the approvals letter preview (Target.createTarget protocol error).
  const { violations } = await new AxeBuilder({ page }).setLegacyMode(true).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const blocking = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(blocking.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

const rowAmounts = async (page: Page) => {
  const cells = await page.locator("tbody tr[data-row-id] td.text-right").allInnerTexts();
  return cells.map(parseUsd);
};

test.describe.configure({ mode: "serial" });
test.beforeAll(() => mkdirSync(SHOTS, { recursive: true }));

test.describe("items: URL filters and server-side sort", () => {
  test("deadline_asc renders sorted rows with no SQL on screen", async ({ page }) => {
    await page.goto("/items?sort=deadline_asc");
    await expect(page.locator("tbody tr[data-row-id]").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Items could not load" })).toHaveCount(0);
    await noRaw(page);
    await expect(page.getByRole("columnheader", { name: /Next deadline/ })).toHaveAttribute("aria-sort", "ascending");
    await page.screenshot({ path: `${SHOTS}/fixC1-items-sorted-1440.png` });
  });

  test("bad filter values fall back instead of crashing", async ({ page }) => {
    for (const q of ["status=dd_due", "type=nope", "state=TEXAS", "minAge=-5", "sort=sideways", "review=maybe"]) {
      await page.goto(`/items?${q}`);
      await expect(page.locator("tbody tr[data-row-id]").first()).toBeVisible();
      await noRaw(page);
    }
  });

  test("clicking Amount writes sort to the URL, sorts every row, survives reload and flips", async ({ page }) => {
    await page.goto("/items");
    await expect(page.locator("tbody tr[data-row-id]").first()).toBeVisible();
    const header = page.getByRole("button", { name: "Amount" });
    await expect(async () => {
      await header.click();
      await expect(page).toHaveURL(/sort=amount_desc/, { timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
    await expect(page.getByRole("columnheader", { name: /Amount/ })).toHaveAttribute("aria-sort", "descending");
    await expect.poll(async () => {
      const a = await rowAmounts(page);
      return a.length > 1 && a.every((v, i) => i === 0 || a[i - 1]! >= v);
    }).toBe(true);
    await page.reload();
    await expect(page.getByRole("columnheader", { name: /Amount/ })).toHaveAttribute("aria-sort", "descending");
    await page.getByRole("button", { name: "Amount" }).click();
    await expect(page).toHaveURL(/sort=amount_asc/);
    await expect.poll(async () => {
      const a = await rowAmounts(page);
      return a.length > 1 && a.every((v, i) => i === 0 || a[i - 1]! <= v);
    }).toBe(true);
  });

  test("footer pluralises a single result", async ({ page }) => {
    await page.goto("/items?q=10482");
    await expect(page.locator("tbody tr[data-row-id]")).toHaveCount(1);
    await expect(page.getByTestId("items-footer")).toContainText(/\b1 item,/);
    await expect(page.getByTestId("items-footer")).not.toContainText("1 items");
  });

  test("Needs review explains itself", async ({ page }) => {
    await page.goto("/items");
    await expect(page.getByRole("button", { name: "Needs review" })).toHaveAttribute("title", /classification confidence/);
  });
});

test.describe("keyboard focus", () => {
  test("items drawer takes focus, traps Tab, and returns focus to the row on Escape", async ({ page }) => {
    await page.goto("/items");
    const rows = page.locator("tbody tr[data-row-id]");
    await expect(rows.first()).toBeVisible();
    const openBtn = rows.first().getByRole("button", { name: /^Open / });
    await openBtn.focus();
    await expect(async () => {
      await page.keyboard.press("Enter");
      await expect(page.getByTestId("item-drawer")).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
    await expect(async () => {
      const inside = await page.evaluate(() => !!document.activeElement?.closest("[data-testid='item-drawer']"));
      expect(inside).toBe(true);
    }).toPass({ timeout: 5_000 });
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press("Tab");
      // The trap's edge guards hand focus back asynchronously, so poll instead of reading once.
      await expect
        .poll(() => page.evaluate(() => !!document.activeElement?.closest("[data-testid='item-drawer']")), { message: `tab stop ${i} stays inside the drawer` })
        .toBe(true);
    }
    // The loop can end on one of the trap's transient edge guards; put focus on a real control before closing.
    await page.getByRole("button", { name: "Close item details" }).focus();
    await page.keyboard.press("Escape");
    await expect(page).not.toHaveURL(/item=/);
    await expect(page.getByTestId("item-drawer")).toBeHidden();
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? "")).toMatch(/^Open /);
  });

  test("approvals: j moves focus to the detail heading", async ({ page }) => {
    await page.goto("/approvals");
    const keys = page.locator("[data-key]");
    test.skip((await keys.count()) < 2, "needs two queue entries");
    await expect(keys.first()).toBeVisible();
    await page.locator("body").click({ position: { x: 1, y: 1 } });
    await expect(async () => {
      await page.keyboard.press("j");
      const onHeading = await page.evaluate(() => document.activeElement?.hasAttribute("data-detail-heading") ?? false);
      expect(onHeading).toBe(true);
    }).toPass({ timeout: 15_000 });
  });

  test("palette: Enter opens the first result", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(async () => {
      await page.keyboard.press("Control+k");
      await expect(page.getByPlaceholder(/Search pages/)).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
    await page.getByPlaceholder(/Search pages/).fill("10482");
    // Item results load async; the "Ask the agent" row also contains the query, so wait for a real item row first.
    await expect(page.locator("[cmdk-item][data-value^='item-']").first()).toContainText("10482");
    await expect(page.getByRole("option").first()).toHaveAttribute("data-value", /^item-/);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/items\?item=/);
  });
});

test.describe("dashboard", () => {
  test("hero is split into what the total is made of; Needs you opens Approvals", async ({ page }) => {
    await page.goto("/dashboard");
    const hero = page.getByRole("region", { name: "Total exposure" });
    await expect(hero.getByText("Outstanding, not yet filed")).toBeVisible();
    await expect(hero.getByRole("list", { name: "What the total is made of" })).toBeVisible();
    await expect(page.getByText("At risk today")).toHaveCount(0);
    await expect(page.getByText(DISCLAIMER)).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/fixC1-dashboard-1440.png`, fullPage: true });
    const needs = hero.getByRole("link", { name: "Review approvals" });
    if (await needs.count()) await expect(needs).toHaveAttribute("href", "/approvals");
  });
});

test.describe("approvals: owner link, offline send", () => {
  test.skip(!OFFLINE, "offline send needs ESCHEAT_OFFLINE=1");

  test("a composed letter can be approved without OWNER_LINK_SECRET issues, sent offline, and leaves the queue", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/items?item=10087");
    const draft = page.getByTestId("item-drawer").getByRole("button", { name: "Draft outreach" });
    // Either the draft button (no draft yet) or the link to an existing draft shows up once the drawer has loaded.
    const existing = page.getByRole("link", { name: "Review in approvals" });
    await expect(draft.or(existing).first()).toBeVisible({ timeout: 30_000 });
    if (await draft.isVisible()) {
      await draft.click();
      await expect(existing).toBeVisible();
    }
    await page.goto("/approvals");
    const row = page.locator("[data-key^='o:']").filter({ hasText: "Ravenhill Cabinetry" }).first();
    await expect(row).toBeVisible();
    await row.click();
    const detail = page.getByTestId("approval-detail");
    const compose = detail.getByTestId("compose-btn");
    if (await compose.isVisible().catch(() => false)) {
      await compose.click();
      await expect(compose).toBeHidden({ timeout: 20_000 });
    }
    const queueBefore = Number(await page.getByTestId("queue-count").innerText());
    const approve = detail.getByTestId("approve-btn");
    await fillApprover(detail);
    if (await approve.isEnabled()) {
      await approve.click();
      await expect(detail.getByText(/Approved by/)).toBeVisible({ timeout: 20_000 });
    }
    await page.screenshot({ path: `${SHOTS}/fixC1-approvals-approved-1440.png` });
    await detail.getByTestId("send-btn").click();
    await expect(detail.getByTestId("send-outcome")).toContainText("Offline mode: nothing was sent.");

    // Terminal state: labelled, Send gone, out of the waiting count, and the sidebar badge agrees with the list header.
    await expect(detail.getByText(/Sent \(offline — nothing mailed\) on \d{4}-\d{2}-\d{2}/)).toBeVisible({ timeout: 20_000 });
    await expect(detail.getByTestId("send-btn")).toHaveCount(0);
    await expect(page.getByTestId("queue-count")).toHaveText(String(queueBefore - 1));
    const badge = page.locator("aside [title$='waiting for your approval']").first();
    if (queueBefore - 1 > 0) await expect(badge).toContainText(new RegExp(`^${queueBefore - 1}\\b`));
    await expect(row).toContainText("Sent (offline");
    await page.screenshot({ path: `${SHOTS}/fixC1-approvals-sent-1440.png` });
  });

  test("a second send is refused with the date, not a raw approval error", async ({ page, request }) => {
    await page.goto("/approvals");
    const row = page.locator("[data-key^='o:']").filter({ hasText: "Sent (offline" }).first();
    await expect(row).toBeVisible();
    const id = (await row.getAttribute("data-key"))!.slice(2);
    const origin = new URL(page.url()).origin;
    const res = await request.post(`/api/outreach/${id}/send`, { headers: { origin, "content-type": "application/json" }, data: {} });
    expect(res.status()).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/^Already sent on \d{4}-\d{2}-\d{2}/);
    expect(body.error).not.toMatch(/consumed/);
  });
});

test.describe("items table fits the main column", () => {
  for (const w of [1024, 1280]) {
    for (const path of ["/items", "/items?item=10482"]) {
      test(`no sideways page scroll at ${w}px on ${path}`, async ({ page }) => {
        test.setTimeout(120_000);
        await page.setViewportSize({ width: w, height: 900 });
        await page.goto(path);
        await expect(page.locator("tbody tr[data-row-id]").first()).toBeVisible();
        if (path.includes("item=")) await expect(page.getByTestId("item-drawer")).toContainText("Bayline Electric");
        await noOverflow(page);
        // The check number is still reachable below xl, under the payee name.
        await expect(page.locator("tbody tr[data-row-id]").first()).toContainText(/#\d+/);
      });
    }
  }
});

test.describe("layout and accessibility", () => {
  for (const [w, h] of [
    [375, 812],
    [1024, 768],
    [1440, 900],
  ] as const) {
    test(`no overflow and axe-clean at ${w}px`, async ({ page }) => {
      // Three pages, each with an axe pass: CI runners need more than two minutes under load.
      test.setTimeout(240_000);
      await page.setViewportSize({ width: w, height: h });
      for (const path of ["/dashboard", "/items?sort=amount_desc", "/approvals"]) {
        await page.goto(path);
        await expect(page.getByText(DISCLAIMER)).toBeVisible();
        await noOverflow(page);
        await expectAxeClean(page);
      }
      if (w === 375) {
        await page.goto("/dashboard");
        await page.screenshot({ path: `${SHOTS}/fixC1-dashboard-375.png`, fullPage: true });
        await page.goto("/items?sort=amount_desc");
        await expect(page.locator("tbody tr[data-row-id]").first()).toBeVisible();
        await page.screenshot({ path: `${SHOTS}/fixC1-items-sorted-375.png` });
        await page.goto("/approvals");
        await page.screenshot({ path: `${SHOTS}/fixC1-approvals-375.png` });
      }
    });
  }
});
