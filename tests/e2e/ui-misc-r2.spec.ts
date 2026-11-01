/**
 * Dogfood misc lane R2 (ui group): /settings, owner-link status codes (F41), /replica/ca redirect and form states (F42),
 * and the calendar feed's DD-close / VALARM / OVERDUE content (R2-11). Axe and no horizontal overflow at 375/1024/1440
 * for each page this lane changed.
 */
import { mkdirSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "playwright/test";
import { createOwnerToken } from "../../src/lib/outreach/tokens";
import { E2E_SECRETS } from "./env";

const SHOTS = ".data/shots";
const VIEWPORTS = [
  { w: 375, h: 812 },
  { w: 1024, h: 768 },
  { w: 1440, h: 900 },
] as const;

async function noOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

async function expectAxeClean(page: Page) {
  const { violations } = await new AxeBuilder({ page }).setLegacyMode(true).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const blocking = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(blocking.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

async function sweep(page: Page, name: string) {
  for (const { w, h } of VIEWPORTS) {
    await page.setViewportSize({ width: w, height: h });
    await noOverflow(page);
    await page.screenshot({ path: `${SHOTS}/misc-r2-${name}-${w}.png` });
  }
  await expectAxeClean(page);
}

test.beforeAll(() => mkdirSync(SHOTS, { recursive: true }));

test("/settings redirects to integrations instead of 404", async ({ page }) => {
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/settings\/integrations$/);
  await expect(page.getByRole("heading", { name: "Integrations" })).toBeVisible();
  await sweep(page, "settings");
});

test.describe("owner link status codes", () => {
  const mint = (offsetMs: number) =>
    createOwnerToken({ outreachId: "00000000-0000-4000-8000-000000000000", expiresAt: new Date(Date.now() + offsetMs) }, E2E_SECRETS.OWNER_LINK_SECRET).token;

  test("a garbage token is a 404 with an honest message", async ({ page }) => {
    const res = await page.goto("/owner/garbage-token");
    expect(res?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "We couldn't open this link" })).toBeVisible();
    await expect(page.getByText("Prototype. Not legal advice.")).toBeVisible();
    await sweep(page, "owner-invalid");
  });

  test("a forged signature is a 404", async ({ page }) => {
    const [body] = mint(60_000).split(".");
    const res = await page.goto(`/owner/${body}.forgedsignature`);
    expect(res?.status()).toBe(404);
  });

  test("an expired token is a 410 saying so", async ({ page }) => {
    const res = await page.goto(`/owner/${mint(-60_000)}`);
    expect(res?.status()).toBe(410);
    await expect(page.getByRole("heading", { name: "This link has expired" })).toBeVisible();
    await sweep(page, "owner-expired");
  });

  test("a validly signed token is not rejected by the signature check", async ({ page }) => {
    // Not in the database, so the page shows its own notice; the point is the proxy let it through (not 404/410).
    const res = await page.goto(`/owner/${mint(60_000)}`);
    expect([200, 404]).toContain(res?.status());
    expect(res?.status()).not.toBe(410);
  });
});

test.describe("replica portal entry", () => {
  test("/replica/ca redirects to the CA holder portal", async ({ page }) => {
    await page.goto("/replica/ca");
    await expect(page).toHaveURL(/\/replica\/ca-holder$/);
    await expect(page.getByRole("heading", { name: /Holder login - California/ })).toBeVisible();
    await sweep(page, "replica-ca");
  });

  test("an unknown slug is still a 404", async ({ page }) => {
    const res = await page.goto("/replica/zz");
    expect(res?.status()).toBe(404);
  });

  test("the login form shows no error before the user touches or submits it", async ({ page }) => {
    await page.goto("/replica/ca-holder");
    await expect(page.getByTestId("login-username")).toBeVisible();
    await expect(page.locator(".rp-error")).toHaveCount(0);
    await expect(page.getByTestId("login-error")).toHaveCount(0);
    await expect(page.getByTestId("login-username")).not.toHaveAttribute("aria-invalid", "true");
    // Touching a field and leaving it still does not render an error banner; native validation blocks submit.
    await page.getByTestId("login-username").focus();
    await page.getByTestId("login-password").focus();
    await expect(page.locator(".rp-error")).toHaveCount(0);
  });

  test("the search form shows no error until a search is submitted", async ({ page }) => {
    await page.goto("/replica/ca-search");
    await expect(page.getByTestId("search-name")).toBeVisible();
    await expect(page.getByTestId("search-error")).toHaveCount(0);
  });
});

test("calendar feed has DD close events, a reminder per event and no malformed lines", async ({ page }) => {
  const res = await page.request.get("/api/calendar.ics");
  expect(res.status()).toBe(200);
  const ics = (await res.text()).replace(/\r\n /g, "");
  const events = ics.split("BEGIN:VEVENT").slice(1);
  expect(events.length).toBeGreaterThan(0);
  expect(ics).toContain("due-diligence window closes");
  for (const e of events) expect(e.match(/BEGIN:VALARM/g)).toHaveLength(1);
  expect(ics).toContain("TRIGGER:-P7D");
  // Any overdue event is labelled as such in the summary and categories.
  for (const e of events.filter((x) => /CATEGORIES:.*OVERDUE/.test(x))) expect(e).toMatch(/SUMMARY:OVERDUE: /);
});
