import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "playwright/test";

/**
 * Automated accessibility sweep: axe-core (WCAG 2.0/2.1 A + AA) on every page at 1440 and 375 px.
 * Serious and critical violations fail the test; moderate and minor ones are attached as test annotations
 * (visible in the HTML/JSON reporters) so they stay visible without blocking.
 * Runs in the "a11y" e2e group (own server) because the owner-link setup drafts a letter.
 */

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const BLOCKING = new Set(["serious", "critical"]);
const WIDTHS = [1440, 375] as const;

interface PageCase {
  name: string;
  path: string;
  /** Element that proves the page (or the drawer) has rendered before axe runs. */
  ready: string;
  /** When false, violations are reported as annotations only (see the TODO on the chat entry). */
  assert?: boolean;
}

const PAGES: PageCase[] = [
  { name: "home", path: "/", ready: "h1" },
  { name: "how-it-works", path: "/how-it-works", ready: "h1" },
  { name: "security", path: "/security", ready: "h1" },
  { name: "login", path: "/login", ready: "h1" },
  { name: "dashboard", path: "/dashboard", ready: "main h1, main h2" },
  { name: "items", path: "/items", ready: "table[aria-label='Stale items']" },
  { name: "items drawer", path: "/items?item=10482", ready: "[data-testid='item-drawer']" },
  { name: "approvals", path: "/approvals", ready: "main" },
  { name: "rules", path: "/rules", ready: "main h1, main h2" },
  { name: "reports", path: "/reports", ready: "main h1, main h2" },
  { name: "recoveries", path: "/recoveries", ready: "main h1, main h2" },
  { name: "runs", path: "/runs", ready: "main h1, main h2" },
  { name: "eval", path: "/eval", ready: "main h1, main h2" },
  { name: "integrations", path: "/settings/integrations", ready: "main h1, main h2" },
  { name: "chat", path: "/chat", ready: "main" },
  { name: "404", path: "/this-page-does-not-exist", ready: "h1" },
];

type Violation = Awaited<ReturnType<AxeBuilder["analyze"]>>["violations"][number];

function describeViolation(v: Violation): string {
  const nodes = v.nodes.slice(0, 4).map((n) => `    ${n.target.join(" ")}\n      ${(n.failureSummary ?? "").split("\n").slice(0, 3).join(" | ")}`);
  const more = v.nodes.length > 4 ? `\n    ... +${v.nodes.length - 4} more` : "";
  return `[${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} nodes)\n${nodes.join("\n")}${more}`;
}

async function settle(page: Page, ready: string): Promise<void> {
  await expect(page.locator(ready).first()).toBeVisible();
  // Streamed Suspense content and fonts; dev-server websockets can keep the network busy, so cap the wait.
  await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
  await page.evaluate(() => document.fonts.ready);
}

/** Runs axe, annotates non-blocking findings, and fails on serious/critical ones (unless `enforce` is false). */
async function expectNoBlockingViolations(page: Page, label: string, enforce = true): Promise<void> {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  const blocking = violations.filter((v) => BLOCKING.has(v.impact ?? ""));
  const advisory = violations.filter((v) => !BLOCKING.has(v.impact ?? ""));
  for (const v of advisory) test.info().annotations.push({ type: `a11y-${v.impact ?? "unknown"}`, description: `${label}: ${describeViolation(v)}` });
  if (!enforce) {
    for (const v of blocking) test.info().annotations.push({ type: `a11y-${v.impact}-not-enforced`, description: `${label}: ${describeViolation(v)}` });
    return;
  }
  expect(blocking.map(describeViolation), `${label}: serious/critical axe violations`).toEqual([]);
}

// Animations (page reveals, drawer slide) would make contrast checks sample half-faded colours.
test.use({ reducedMotion: "reduce" });

let ownerPath: string | null = null;

test.beforeAll(async ({ browser }, testInfo) => {
  // The e2e way to a signed owner link (demo-path c1): draft a letter for check #10482 and read the link out of
  // the stored letter HTML. Opening the page does not consume the link; only submitting a response does.
  const page = await browser.newPage({ baseURL: testInfo.project.use.baseURL });
  try {
    await page.goto("/items?item=10482");
    await page.getByTestId("item-drawer").getByRole("button", { name: "Draft outreach" }).click();
    await expect(page.getByRole("link", { name: "Review in approvals" })).toBeVisible();
    await page.goto("/approvals");
    const row = page.locator("[data-key^='o:']").filter({ hasText: "Bayline Electric" }).first();
    await expect(row).toBeVisible();
    const letterId = (await row.getAttribute("data-key"))!.slice(2);
    const html = await (await page.request.get(`/api/outreach/${letterId}/preview`)).text();
    ownerPath = /\/owner\/[A-Za-z0-9_.~%-]+/.exec(html)?.[0] ?? null;
  } finally {
    await page.close();
  }
});

for (const width of WIDTHS) {
  test.describe(`axe @ ${width}px`, () => {
    test.use({ viewport: { width, height: width === 375 ? 812 : 900 } });

    for (const c of PAGES) {
      test(`${c.name} (${c.path}) has no serious or critical violations`, async ({ page }) => {
        const response = await page.goto(c.path);
        if (c.name === "404") expect(response?.status()).toBe(404);
        if (c.name === "login") await expect(page, "/login must be reachable with no passcode set").toHaveURL(/\/login/);
        await settle(page, c.ready);
        await expectNoBlockingViolations(page, `${c.path} @${width}`, c.assert !== false);
      });
    }

    test("owner response page has no serious or critical violations", async ({ page }) => {
      expect(ownerPath, "owner link built from a drafted letter").toBeTruthy();
      await page.goto(ownerPath!);
      await settle(page, "main h1");
      await expectNoBlockingViolations(page, `/owner/<token> @${width}`);
    });
  });
}
