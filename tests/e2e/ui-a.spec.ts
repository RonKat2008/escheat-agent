import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "playwright/test";

const RULES = path.join(process.cwd(), "rules");

test.describe("marketing site", () => {
  for (const route of ["/", "/how-it-works", "/security"]) {
    test(`${route} renders with one h1, the disclaimer and a demo CTA`, async ({ page }) => {
      await page.goto(route);
      await expect(page.locator("h1")).toHaveCount(1);
      await expect(page.getByText("Prototype. Not legal advice. Confirm filings with a qualified professional.")).toBeVisible();
      await expect(page.getByRole("link", { name: "Open the demo" }).first()).toHaveAttribute("href", "/dashboard");
    });

    test(`${route} has no horizontal overflow at 375px`, async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto(route);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }

  test("with reduced motion every heading and walkthrough step is fully visible", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    const headings = page.locator("main h2");
    expect(await headings.count()).toBeGreaterThanOrEqual(6);
    for (const h of await headings.all()) {
      await expect(h).toBeVisible();
      const transform = await h.locator(".mkt-reveal-inner").evaluate((el) => getComputedStyle(el).transform);
      expect(transform === "none" || transform === "matrix(1, 0, 0, 1, 0, 0)").toBe(true);
    }
    const steps = page.locator(".mkt-scrolly-list li");
    await expect(steps).toHaveCount(6);
    for (const step of await steps.all()) {
      const opacity = await step.evaluate((el) => getComputedStyle(el).opacity);
      expect(opacity).toBe("1");
      const title = await step.locator("h3").evaluate((el) => getComputedStyle(el).color);
      expect(title).toBe(await steps.first().locator("h3").evaluate((el) => getComputedStyle(el).color));
    }
    await expect(page.locator(".mkt-log li[data-on='true']")).toHaveCount(8);
  });

  test("keyboard: the skip link is the first stop and moves focus to main", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to content" });
    await expect(skip).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("main#main")).toBeFocused();
  });

  test("phone nav opens a menu with both pages and closes on Escape", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");
    const toggle = page.getByRole("button", { name: "Open menu" });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    const menu = page.getByRole("navigation", { name: "Mobile navigation" });
    await expect(menu.getByRole("link", { name: "How it works" })).toBeVisible();
    await expect(menu.getByRole("link", { name: "Trust and safety" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
  });
});

test.describe("dashboard", () => {
  test("shows the exposure total and the featured check", async ({ page }) => {
    await page.goto("/dashboard");
    const hero = page.getByRole("region", { name: "Total exposure" });
    await expect(hero).toContainText(/\$[\d,]+\.\d{2}/);
    await expect(hero.getByTestId("exposure-meta")).toContainText("stale items");
    await expect(page.getByRole("region", { name: "Featured item" })).toContainText("#10482");
    await expect(page.getByText("Prototype. Not legal advice. Confirm filings with a qualified professional.")).toBeVisible();
  });

  test("demo clock popover opens with its controls", async ({ page }) => {
    await page.goto("/dashboard");
    await page.getByRole("button", { name: /Demo clock/ }).click();
    await expect(page.getByRole("button", { name: "+30d" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Reset to start/ })).toBeVisible();
  });
});

test.describe("items", () => {
  test("opens the drawer from the URL with an unverified timeline", async ({ page }) => {
    await page.goto("/items?item=10482");
    const drawer = page.getByTestId("item-drawer");
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText("Bayline Electric");
    await expect(drawer.getByTestId("item-timeline")).toContainText("Business threshold, not law");
    await expect(drawer.getByTestId("unverified-badge").first()).toBeVisible();
    await expect(drawer.getByRole("button", { name: "Draft outreach" })).toBeVisible();
  });

  test("filters live in the URL and the footer total follows", async ({ page }) => {
    await page.goto("/items?state=TX");
    await expect(page.getByTestId("items-footer")).toContainText(/\d+ items/);
    await expect(page.locator("tbody tr[data-row-id]").first()).toBeVisible();
    const states = await page.locator("tbody tr[data-row-id] td:nth-child(3)").allInnerTexts();
    expect(states.every((s) => s.trim() === "TX")).toBe(true);
  });

  test("j moves the active row and Enter opens it", async ({ page }) => {
    await page.goto("/items");
    await page.locator("tbody tr[data-row-id]").first().waitFor();
    // Key handlers attach on hydration, which can land after networkidle on a cold CI server: retry the press.
    await expect(async () => {
      await page.keyboard.press("j");
      await expect(page.locator("tbody tr[data-selected]")).toHaveCount(1, { timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/item=/);
    await expect(page.getByTestId("item-drawer")).toBeVisible();
  });
});

test.describe("rules approval", () => {
  const snapshot = new Map<string, string>();
  let historyBefore: Set<string>;

  test.beforeAll(() => {
    for (const f of readdirSync(RULES).filter((x) => /^[A-Z]{2}\.json$/.test(x))) snapshot.set(f, readFileSync(path.join(RULES, f), "utf8"));
    const h = path.join(RULES, "history");
    historyBefore = new Set(existsSync(h) ? readdirSync(h, { recursive: true }).map(String) : []);
  });

  test.afterAll(async ({ request }) => {
    for (const [f, text] of snapshot) writeFileSync(path.join(RULES, f), text);
    const h = path.join(RULES, "history");
    if (existsSync(h)) {
      for (const rel of readdirSync(h, { recursive: true }).map(String)) {
        if (!historyBefore.has(rel) && rel.endsWith(".json")) rmSync(path.join(h, rel), { force: true });
      }
    }
    // re-pin items to the restored version
    await request.post("/api/clock", { data: { action: "advance", days: 0 } });
  });

  test("approving one value verifies it after confirmation", async ({ page }) => {
    await page.goto("/rules?state=TX");
    const first = page.getByTestId("approve-field").first();
    const row = page.locator("tr[data-field]").filter({ has: first }).first();
    const field = await row.getAttribute("data-field");
    await first.click();
    await page.getByLabel("Approving as").fill("Test Reviewer");
    await page.getByTestId("confirm-approve").click();
    await expect(page.getByText(/verified by Test Reviewer/).first()).toBeVisible();
    await expect(page.locator(`tr[data-field="${field}"]`)).toContainText("Verified");
    await expect(page.locator(`tr[data-field="${field}"]`)).toContainText("Test Reviewer");
  });
});
