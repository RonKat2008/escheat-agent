/**
 * Dogfood fixes F14/F15/F27 (date derivations), F18/F19 (rule review flow) and F17 (demo clock reset).
 * Rule approvals are DB rows (R4-02): rules/ is never written; the spec withdraws its approval and leaves the clock at the anchor.
 */
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "playwright/test";

const RULES = path.join(process.cwd(), "rules");
const SHOTS = path.join(process.cwd(), ".data", "shots");
const WIDTHS = [375, 1024, 1440] as const;
const BLOCKING = new Set(["serious", "critical"]);

test.use({ reducedMotion: "reduce" });

async function shot(page: Page, name: string) {
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `fixA-${name}.png`), fullPage: false });
}

async function expectAxeClean(page: Page, label: string) {
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const blocking = violations.filter((v) => BLOCKING.has(v.impact ?? "")).map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
  expect(blocking, `${label}: serious/critical axe violations`).toEqual([]);
}

async function expectNoOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  // On failure, name the elements that stick out so the cause is obvious.
  const culprits =
    overflow > 0
      ? await page.evaluate(() =>
          [...document.querySelectorAll("body *")]
            // Elements whose own content is wider than the viewport and that do not clip it.
            .filter((el) => el.scrollWidth > document.documentElement.clientWidth && getComputedStyle(el).overflowX === "visible")
            .reverse()
            .slice(0, 8)
            .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 80)} sw=${el.scrollWidth} w=${Math.round(el.getBoundingClientRect().width)}`),
        )
      : [];
  expect(overflow, culprits.join("\n")).toBeLessThanOrEqual(0);
}

test.describe("item drawer: every date explains itself (F14, F15, F27)", () => {
  test("derivation text, roll provenance, expanded rule refs and one agreeing 'next deadline'", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/items?item=10482");
    const drawer = page.getByTestId("item-drawer");
    await expect(drawer).toContainText("Bayline Electric");
    const node = (key: string) => drawer.locator(`[data-node="${key}"]`);

    await expect(node("presumed_abandoned").getByTestId("node-derivation")).toContainText("Sep 1, 2025 + 3-year dormancy = Sep 1, 2028");
    await expect(node("report_due").getByTestId("node-derivation")).toContainText("fiscal year end (Dec 31");
    await expect(node("report_due").getByTestId("node-derivation")).toContainText("so it moves to the next Oct 31: Oct 31, 2029");
    await expect(node("dd_window_start").getByTestId("node-derivation")).toContainText("Oct 31, 2029 − 365 days = Oct 31, 2028");
    // F27: the roll-forward is stated, with the rule and the counsel flag.
    const roll = node("remit_due").getByTestId("node-roll");
    await expect(roll).toContainText("Jun 15, 2030 is a Saturday, so it rolled forward to Monday, Jun 17, 2030");
    await expect(roll).toContainText("counsel");
    // F15: no "unknown" reason under a resolved date.
    await expect(drawer.getByTestId("item-timeline")).not.toContainText(/is unknown|not provided/);
    // "+N" is gone: rule refs expand into named fields.
    const refs = node("report_due").getByTestId("node-rules");
    await expect(refs).not.toContainText("+");
    await refs.locator("summary").click();
    await expect(refs).toContainText("Report stage notice: report due");
    // Each source URL once.
    const hrefs = await node("report_due").locator("a[href^='http']").evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href));
    expect(new Set(hrefs).size).toBe(hrefs.length);
    // The pink "Next deadline" chip sits on the date the footer names.
    await expect(drawer.getByText("Next deadline")).toHaveCount(1);
    await expect(node("dd_window_start")).toContainText("Next deadline");
    await expect(drawer).toContainText("Next legal date: Due diligence opens, Oct 31, 2028");

    await shot(page, "drawer-timeline-1440");
    await expectAxeClean(page, "items drawer");
    for (const w of WIDTHS) {
      await page.setViewportSize({ width: w, height: 900 });
      await expectNoOverflow(page);
    }
    await page.setViewportSize({ width: 375, height: 812 });
    await node("presumed_abandoned").scrollIntoViewIfNeeded();
    await shot(page, "drawer-timeline-375");
  });
});

test.describe("rules: review one value at a time (F18, F19)", () => {
  const snapshot = new Map<string, string>();
  let approvedVersion: string | null = null;

  test.beforeAll(() => {
    for (const f of readdirSync(RULES).filter((x) => /^[A-Z]{2}\.json$/.test(x))) snapshot.set(f, readFileSync(path.join(RULES, f), "utf8"));
  });

  test.afterAll(async ({ request }) => {
    if (approvedVersion) {
      const res = await request.post("/api/rules/DE/withdraw", { data: { version: approvedVersion, withdrawnBy: "Test Reviewer" } });
      expect(res.status(), await res.text()).toBe(200);
    }
    for (const [f, text] of snapshot) expect(readFileSync(path.join(RULES, f), "utf8"), `rules/${f} must not change`).toBe(text);
    await request.post("/api/clock", { data: { action: "advance", days: 0 } }); // re-pin items to the restored version
  });

  test("leads with 'Review next unverified value'; the checklist approval is secondary, unticked per value (R4-20)", async ({ page }) => {
    test.setTimeout(180_000); // approves a value and recomputes every timeline on a shared, loaded dev server
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/rules?state=DE");
    const toolbar = page.getByTestId("review-toolbar");
    await expect(toolbar).toBeVisible();
    const review = page.getByTestId("review-next");
    const bulk = page.getByTestId("approve-all");
    await expect(review).toBeVisible();
    await expect(bulk).toContainText("Approve from a checklist");
    await shot(page, "rules-review-1440");
    await expectAxeClean(page, "rules");

    // Checklist: every value + source with its own unticked checkbox; nothing is sent until one is ticked; we cancel.
    await expect(async () => {
      await bulk.click();
      await expect(page.getByTestId("approve-all-list")).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
    const count = await page.getByTestId("approve-all-list").locator("li").count();
    await expect(page.getByTestId("approve-all-check")).toHaveCount(count);
    await page.getByLabel("Approving as").fill("Test Reviewer");
    await expect(page.getByTestId("confirm-approve")).toBeDisabled();
    await page.getByTestId("approve-all-check").first().check();
    await expect(page.getByTestId("confirm-approve")).toBeEnabled();
    await shot(page, "rules-bulk-confirm-1440");
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByTestId("approve-all-list")).toBeHidden();

    // Step-through review: skip, then approve; the drawer advances to the next value.
    await review.click();
    const progress = page.getByTestId("review-progress");
    await expect(progress).toContainText(`1 of ${count}`);
    await page.getByTestId("review-skip").click();
    await expect(progress).toContainText(`2 of ${count}`);
    const field = new URL(page.url()).searchParams.get("field")!;
    await shot(page, "rules-review-drawer-1440");
    await page.getByTestId("approve-field-drawer").click();
    await page.getByLabel("Approving as").fill("Test Reviewer");
    await page.getByTestId("confirm-approve").click();
    // The server action saves a new version and recomputes every timeline: slow on a loaded dev server.
    await expect(page.locator(`tr[data-field="${field}"]`)).toContainText("Verified", { timeout: 60_000 });
    await expect(page.getByTestId("review-progress")).toContainText(`of ${count - 1}`);
    await expect(page).not.toHaveURL(new RegExp(`field=${encodeURIComponent(field).replace(/[[\]]/g, "\\$&")}$`));

    // R4-02: the approval is a DB row; the checked-in file is unchanged. Remember the version to withdraw it.
    expect(readFileSync(path.join(RULES, "DE.json"), "utf8")).toBe(snapshot.get("DE.json"));
    const cur = (await (await page.request.get(`/api/rules/DE/adopt?path=${encodeURIComponent(field)}`)).json()) as { expectedVersion: string };
    expect(cur.expectedVersion).toMatch(/\+appr\./);
    approvedVersion = cur.expectedVersion;

    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/rules?state=DE");
    await expect(page.getByTestId("review-next")).toBeVisible();
    await expectNoOverflow(page);
    await shot(page, "rules-review-375");
    for (const w of [1024, 1440]) {
      await page.setViewportSize({ width: w, height: 900 });
      await expectNoOverflow(page);
    }
  });
});

test.describe("demo clock reset (F17)", () => {
  test("Reset puts the dashboard back exactly as it was at the anchor", async ({ page, request }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const dashboard = async () => {
      await page.goto("/dashboard");
      await expect(page.getByTestId("demo-date")).toHaveText("2026-11-01");
      await expect(page.getByTestId("state-tile-CA")).toBeVisible();
      // The Money flow cards render once the diagram has measured its width (after hydration): wait for them so both
      // reads compare the finished page, not one taken before the cards existed.
      await expect(page.locator("[data-flow-root] [data-flow-node]").first()).toBeVisible({ timeout: 30_000 });
      return page.locator("main").innerText();
    };
    const before = await dashboard();

    const adv = await request.post("/api/clock", { data: { action: "advance", days: 365 } });
    expect(adv.ok()).toBe(true);
    expect(((await adv.json()) as { transitions: unknown[] }).transitions.length).toBeGreaterThan(0);

    await page.goto("/dashboard");
    await expect(page.getByTestId("demo-date")).toHaveText("2027-11-01");
    await expect(async () => {
      await page.getByRole("button", { name: /Demo clock/ }).click();
      await expect(page.getByTestId("clock-reset")).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
    await page.getByTestId("clock-reset").click();
    await expect(page.getByText(/Reset: demo date is now Nov 1, 2026/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Statuses recomputed for the start date/)).toBeVisible();
    await expect(page.getByTestId("demo-date")).toHaveText("2026-11-01");

    expect(await dashboard()).toBe(before);
  });
});
