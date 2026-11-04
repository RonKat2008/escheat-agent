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
  { name: "items drawer", path: "/items?item=10087", ready: "[data-testid='item-drawer']" },
  { name: "payees", path: "/payees", ready: "table[aria-label='Payees']" },
  { name: "approvals", path: "/approvals", ready: "main" },
  { name: "rules", path: "/rules", ready: "main h1, main h2" },
  { name: "reports", path: "/reports", ready: "main h1, main h2" },
  { name: "recoveries", path: "/recoveries", ready: "main h1, main h2" },
  { name: "activity", path: "/activity", ready: "main h1, main h2" },
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
  // Legacy mode runs axe in the page (and its frames) instead of opening a helper page per run: the approvals letter
  // preview iframe made the non-legacy run slow enough to hit the test timeout in CI, which then failed on
  // "browserContext.newPage: Protocol error" while the context was being torn down.
  const { violations } = await new AxeBuilder({ page }).setLegacyMode(true).withTags(WCAG_TAGS).analyze();
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
// First visits compile routes on the CI dev server (tens of seconds for /approvals); 30s was not enough room.
test.describe.configure({ timeout: 120_000 });

let ownerPath: string | null = null;
/** Why the owner link could not be built; the owner-page tests report it instead of the whole file failing. */
let ownerSetupError: string | null = null;

/** The e2e way to a signed owner link (demo-path c1): draft a letter for check #10087 and read the link out of the
 * stored letter HTML. The letter id comes from the draft response itself, not from finding the row on /approvals
 * (a list that other drafts, sorting and slow dev compiles can push the row around in). */
async function buildOwnerPath(page: Page): Promise<string> {
  await page.goto("/items?item=10087", { timeout: 90_000 });
  const drawer = page.getByTestId("item-drawer");
  await expect(drawer).toBeVisible({ timeout: 60_000 });
  const draft = drawer.getByRole("button", { name: "Draft outreach" });
  await expect(draft).toBeVisible({ timeout: 60_000 });
  const drafted = page.waitForResponse((r) => r.url().endsWith("/api/outreach/draft") && r.request().method() === "POST", { timeout: 90_000 });
  await draft.click();
  const res = await drafted;
  const body = (await res.json()) as { drafted?: boolean; outreachId?: string; reason?: string };
  if (!body.outreachId) throw new Error(`draft for #10087 returned ${res.status()}: ${body.reason ?? JSON.stringify(body)}`);
  const html = await (await page.request.get(`/api/outreach/${body.outreachId}/preview`)).text();
  const path = /\/owner\/[A-Za-z0-9_.~%-]+/.exec(html)?.[0];
  if (!path) throw new Error(`letter ${body.outreachId} preview has no /owner/ link`);
  return path;
}

test.beforeAll(async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  // Opening the owner page does not consume the link; only submitting a response does. A failure here must not fail
  // every axe test in the file: only the owner-page tests depend on it, and they report ownerSetupError.
  const page = await browser.newPage({ baseURL: testInfo.project.use.baseURL });
  try {
    ownerPath = await buildOwnerPath(page);
  } catch (err) {
    ownerSetupError = err instanceof Error ? err.message : String(err);
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

    test("CSV dropzone error state (rejected file) has no serious or critical violations", async ({ page }) => {
      await page.goto("/settings/integrations");
      await page.locator("input[type=file]").setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: Buffer.from([137, 80, 78, 71]) });
      await settle(page, "[role='alert']:not(#__next-route-announcer__)");
      await expectNoBlockingViolations(page, `/settings/integrations (dropzone error) @${width}`);
    });

    test("owner response page has no serious or critical violations", async ({ page }) => {
      expect(ownerPath, `owner link built from a drafted letter: ${ownerSetupError ?? "no error"}`).toBeTruthy();
      await page.goto(ownerPath!);
      await settle(page, "main h1");
      await expectNoBlockingViolations(page, `/owner/<token> @${width}`);
    });
  });
}
