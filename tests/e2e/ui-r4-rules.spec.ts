/**
 * Round 4 rules slice (R4-01, R4-02, R4-20), on the ui server's fresh seed:
 *   - Rules shows the mono UNVERIFIED pill on unverified values; the checklist approval has no one-click "approve all"
 *     (every value has its own unticked checkbox, a typed name, and only ticked values are sent).
 *   - TX unlock end to end: "Statute says" (verbatim, sources, read-only) next to an EMPTY, required "Owner letter will
 *     say"; holder-addressed text is refused; approve under a typed name; the live "N TX letters can now be drafted"
 *     count; a composed TX letter prints the owner sentence and never "You (the holder)".
 *   - R4-02: the approval is a DB row. Every file under rules/ hashes the same before and after (asserted in-test).
 * The spec withdraws its approval at the end (POST /api/rules/TX/withdraw), so later specs see the seeded TX rules.
 * Screenshots: .data/shots/r4-rules/*.png (375 + 1440).
 */
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "playwright/test";

const DISCLAIMER = "Prototype. Not legal advice. Confirm filings with a qualified professional.";
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const SHOTS = process.env.R4_SHOTS_DIR ?? ".data/shots/r4-rules";
const RULES = path.join(process.cwd(), "rules");
const LANG = "dueDiligence.requiredLanguage";
const OWNER =
  "Northwind Fixtures, Inc. is holding property for you. If you do not claim it, we may be required to deliver it to the Texas Comptroller on or before July 1.";
const APPROVER = "Dana Reviewer";

/** sha256 of every file under rules/ (including history), keyed by relative path. */
function hashRules(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rel of readdirSync(RULES, { recursive: true }).map(String).sort()) {
    const full = path.join(RULES, rel);
    if (statSync(full).isFile()) out[rel] = createHash("sha256").update(readFileSync(full)).digest("hex");
  }
  return out;
}

async function axeBlocking(page: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page }).setLegacyMode(true).withTags(WCAG_TAGS).analyze();
  return violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
}

async function expectNoOverflow(page: Page) {
  const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  expect(sw, `horizontal overflow at ${iw}px`).toBeLessThanOrEqual(iw);
}

const shot = (page: Page, name: string) => page.screenshot({ path: `${SHOTS}/${name}.png` });

test.describe.configure({ mode: "serial" });

test.describe("R4 rules: TX owner wording unlock, DB-backed approvals, UNVERIFIED pills", () => {
  let before: Record<string, string>;
  let approvedVersion: string | null = null;

  test.beforeAll(() => {
    mkdirSync(SHOTS, { recursive: true });
    before = hashRules();
  });

  test.afterAll(async ({ request }) => {
    if (approvedVersion) {
      const res = await request.post("/api/rules/TX/withdraw", { data: { version: approvedVersion, withdrawnBy: APPROVER } });
      expect(res.status(), await res.text()).toBe(200);
    }
    expect(hashRules(), "rules/ must be byte-for-byte unchanged").toEqual(before);
  });

  test("R4-20: UNVERIFIED pills on the Rules page; the checklist approval needs a tick per value and a name", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/rules?state=TX");
    await expect(page.getByText(DISCLAIMER).first()).toBeVisible();
    const pills = page.locator('tr[data-field] [data-testid="unverified-badge"]');
    await expect(pills.first()).toBeVisible({ timeout: 30_000 });
    await expect(pills.first()).toHaveText(/unverified/i);
    await expect(page.getByText(/Approve all with a value/)).toHaveCount(0);

    const bulk = page.getByTestId("approve-all");
    await expect(bulk).toContainText("Approve from a checklist");
    await expect(async () => {
      await bulk.click();
      await expect(page.getByTestId("approve-all-list")).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
    const checks = page.getByTestId("approve-all-check");
    expect(await checks.count()).toBeGreaterThan(1);
    for (const c of await checks.all()) await expect(c).not.toBeChecked();
    await page.getByLabel("Approving as").fill(APPROVER);
    await expect(page.getByTestId("confirm-approve")).toBeDisabled();
    await checks.first().check();
    await expect(page.getByTestId("confirm-approve")).toHaveText("Approve 1 ticked value");
    await expect(page.getByTestId("confirm-approve")).toBeEnabled();
    await shot(page, "rules-checklist-1440");
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByTestId("approve-all-list")).toBeHidden();
    expect(await axeBlocking(page)).toEqual([]);
    await shot(page, "rules-1440");

    // The server refuses an "approve everything" request: the reviewer must name the values.
    expect(hashRules()).toEqual(before);
  });

  test("R4-01 + R4-02: statute vs owner wording, approve, live unlock count, letter uses the owner sentence", async ({ page }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    const preview = await page.request.get(`/api/rules/TX/adopt?path=${LANG}`);
    expect(preview.status()).toBe(200);
    const p = (await preview.json()) as { ownerText: { required: boolean; prefill: string }; impact: { becomeDraftable: { count: number; staleItemIds: string[] } } };
    expect(p.ownerText).toEqual({ required: true, prefill: "" });
    // R5-01: only items TX actually requires a notice for (over the $250 minimum, window open) count as unlocked. On the
    // demo anchor that can honestly be zero; the dialog then says so instead of overstating the unlock.
    const unlockIds = p.impact.becomeDraftable.staleItemIds;
    expect(unlockIds.length).toBe(p.impact.becomeDraftable.count);

    await page.goto(`/rules?state=TX&field=${LANG}`);
    const drawer = page.getByTestId("field-drawer");
    await expect(drawer).toBeVisible({ timeout: 30_000 });
    await drawer.getByTestId("adopt-open").click();
    const dialog = page.getByTestId("adopt-dialog");
    const statute = dialog.getByTestId("statute-says");
    await expect(statute).toContainText("You (the holder) are holding the property", { timeout: 30_000 });
    await expect(dialog.getByTestId("adopt-source-link")).toHaveAttribute("href", "https://claimittexas.gov/docs/96-478.pdf#page=13");
    await expect(statute.getByRole("textbox")).toHaveCount(0); // the statute is read-only
    const input = dialog.getByTestId("owner-text-input");
    await expect(input).toHaveValue(""); // never prefilled with invented wording
    await expect(dialog.getByTestId("adopt-approve")).toBeDisabled();

    // Holder-addressed text is refused in the UI (and by the server).
    await input.fill("You (the holder) are holding the property for the owner of record.");
    await expect(dialog.getByTestId("owner-text-problem")).toContainText("addressed to the holder");
    await expect(dialog.getByTestId("adopt-approve")).toBeDisabled();

    // R5-02: a content-free sentence is refused; the checklist beside the textarea shows what is missing.
    await input.fill("Hi, we have money for you.");
    await expect(dialog.getByTestId("owner-text-problem")).toContainText("statute requires more");
    await expect(dialog.getByTestId("owner-check-agency")).toHaveAttribute("data-present", "false");
    await expect(dialog.getByTestId("owner-check-deadline")).toHaveAttribute("data-present", "false");
    await dialog.getByLabel("Approving as").fill(APPROVER);
    await expect(dialog.getByTestId("adopt-approve")).toBeDisabled();

    await input.fill(OWNER);
    await expect(dialog.getByTestId("owner-text-problem")).toContainText("Ready for approval");
    await expect(dialog.getByTestId("adopt-diff").locator("ins").first()).toBeVisible();
    await expect(dialog.getByTestId("adopt-impact")).toContainText(/TX letter/);
    await expect(dialog.getByTestId("owner-checklist").locator("[data-present='false']")).toHaveCount(0);
    await expect(dialog.getByTestId("adopt-approve")).toBeEnabled();
    expect(await axeBlocking(page)).toEqual([]);
    await shot(page, "tx-owner-wording-1440");
    // R5-02: the checklist stays readable and the dialog never overflows at 375/1024/1440.
    for (const width of [375, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expectNoOverflow(page);
      expect(await axeBlocking(page)).toEqual([]);
      await page.screenshot({ path: `.data/shots/r5-approver/owner-checklist-${width}.png` });
    }
    await page.setViewportSize({ width: 1440, height: 900 });

    const adopted = page.waitForResponse((r) => r.url().endsWith("/api/rules/TX/adopt") && r.request().method() === "POST", { timeout: 180_000 });
    await dialog.getByTestId("adopt-approve").click();
    const res = await adopted;
    expect(res.status()).toBe(201);
    const body = (await res.json()) as { version: string; ownerText: string; draftable: { count: number } };
    approvedVersion = body.version;
    expect(body.ownerText).toBe(OWNER);
    expect(body.draftable.count).toBeGreaterThanOrEqual(unlockIds.length);
    const unlocked = dialog.getByTestId("adopt-unlocked");
    if (body.draftable.count > 0) {
      await expect(unlocked).toHaveText(new RegExp(`^${body.draftable.count} TX letters? can now be drafted`));
    } else {
      await expect(unlocked).toContainText(/No TX letter can be drafted yet/);
    }
    await expect(dialog.getByTestId("adopt-owner-final")).toHaveText(OWNER);
    await shot(page, "tx-unlocked-1440");

    // R4-02: nothing under rules/ changed.
    expect(hashRules()).toEqual(before);

    await dialog.getByTestId("adopt-close").click();
    await expect(drawer.getByTestId("owner-text")).toContainText(OWNER, { timeout: 30_000 });

    // A TX letter that was blocked now drafts, and prints the owner sentence, never holder-addressed statute text.
    if (unlockIds.length > 0) {
      const draft = await page.request.post("/api/outreach/draft", { data: { staleItemId: unlockIds[0], channel: "letter" } });
      expect(draft.status(), await draft.text()).toBe(201);
      const { outreachId, readiness } = (await draft.json()) as { outreachId: string; readiness: { problems: string[] } };
      expect(readiness.problems).toEqual([]);
      const letter = await (await page.request.get(`/api/outreach/${outreachId}/preview`)).text();
      expect(letter).toContain("Northwind Fixtures, Inc. is holding property for you.");
      expect(letter).not.toContain("(the holder)");
    }

    // Version history comes from the DB overlay.
    await page.goto("/rules?state=TX");
    await expect(page.getByText(body.version).first()).toBeVisible({ timeout: 30_000 });
    expect(hashRules()).toEqual(before);
  });

  test("no horizontal overflow at 375/1024/1440 with the wording dialog open", async ({ page }) => {
    for (const width of [375, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/rules?state=TX");
      await expect(page.getByTestId("review-toolbar")).toBeVisible({ timeout: 30_000 });
      await expectNoOverflow(page);
      if (width === 375) await shot(page, "rules-375");
    }
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`/rules?state=TX&field=${LANG}`);
    const drawer = page.getByTestId("field-drawer");
    await expect(drawer).toBeVisible({ timeout: 30_000 });
    await expect(drawer.getByTestId("owner-text")).toBeVisible();
    await shot(page, "tx-drawer-owner-text-375");
    await expectNoOverflow(page);
  });
});
