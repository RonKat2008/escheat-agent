/**
 * DESIGN-V3 slice 5: Rules (provenance graph, R3-05 "Use official text" review), Reports (filing path per state, R3-11
 * one warning count) and the replica portals (both banners, R3-18 bare-state redirect).
 *
 * The e2e server reads the repo's own rules/*.json, so this spec never approves a rule: it asserts the adoption preview
 * and that the server rejects an approval without a name, and checks rules/TX.json is byte-for-byte unchanged.
 * It does generate one report through the API (the same call the Generate button makes) to compare warning counts.
 * Writes .data/shots/v3-rules-*.png, v3-reports-*.png and v3-replica-*.png.
 */
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "playwright/test";
import { summarizeValidation } from "../../src/lib/reports/validation-summary";
import type { ValidationError } from "../../src/lib/reports/validate";

const DISCLAIMER = "Prototype. Not legal advice. Confirm filings with a qualified professional.";
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const SHOTS = ".data/shots";
const TX_RULES = path.join(process.cwd(), "rules", "TX.json");
const LANG = "dueDiligence.requiredLanguage";
const TX_LANG_URL = `/rules?state=TX&field=${LANG}`;

async function axeBlocking(page: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page }).setLegacyMode(true).withTags(WCAG_TAGS).analyze();
  return violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
}

async function expectNoOverflow(page: Page) {
  const { sw, iw, wide } = await page.evaluate(() => {
    const iw = window.innerWidth;
    // On failure, name the outermost elements that stick out, so the message points at the cause.
    const wide = [...document.querySelectorAll("body *")]
      .filter((el) => el.getBoundingClientRect().right > iw + 1 && !el.closest("[data-overflow-ok]"))
      .filter((el, _i, all) => !all.some((o) => o !== el && o.contains(el)))
      .slice(0, 5)
      .map((el) => `${el.tagName.toLowerCase()}${el.getAttribute("data-testid") ? `[${el.getAttribute("data-testid")}]` : ""}.${String(el.className).slice(0, 60)}`);
    return { sw: document.documentElement.scrollWidth, iw, wide };
  });
  expect(sw, `horizontal overflow at ${iw}px: ${wide.join(" ; ")}`).toBeLessThanOrEqual(iw);
}

async function openLanguageDrawer(page: Page) {
  await page.goto(TX_LANG_URL);
  const drawer = page.getByTestId("field-drawer");
  await expect(drawer).toBeVisible({ timeout: 30_000 });
  await expect(drawer.getByTestId("provenance-graph")).toBeVisible();
  return drawer;
}

test.beforeAll(() => mkdirSync(SHOTS, { recursive: true }));

test.describe("rules", () => {
  let txBefore: string;
  test.beforeAll(() => {
    txBefore = readFileSync(TX_RULES, "utf8");
  });
  test.afterAll(() => {
    expect(readFileSync(TX_RULES, "utf8"), "rules/TX.json must not change").toBe(txBefore);
  });

  test("the provenance graph renders value → rule path → real sources → verification", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const drawer = await openLanguageDrawer(page);
    const graph = drawer.getByTestId("provenance-graph");
    await expect(graph).toContainText("rules/TX.json");
    await expect(graph).toContainText(LANG);
    await expect(graph).toContainText("Unknown");
    await expect(graph).toContainText("UNVERIFIED");
    // Source nodes are the rule file's own citations, as real links that open in a new tab.
    const tx = JSON.parse(txBefore) as { dueDiligence: { requiredLanguage: { sources: { url: string }[] } } };
    const urls = tx.dueDiligence.requiredLanguage.sources.map((s) => s.url);
    const links = graph.getByTestId("provenance-source");
    await expect(links).toHaveCount(urls.length);
    for (const [i, url] of urls.entries()) {
      await expect(links.nth(i)).toHaveAttribute("href", url);
      await expect(links.nth(i)).toHaveAttribute("target", "_blank");
    }
    // Plain-language status instead of the developer research note for an unknown value.
    await expect(drawer).toContainText("Texas notice wording not yet confirmed; official text found at");
    await expect(drawer).not.toContainText("compose.test.ts");
    // A value that is set draws a solid chain too.
    await page.getByRole("button", { name: /Close rule value details/ }).click();
    await page.locator("tr[data-field] button").first().click();
    await expect(drawer.getByTestId("provenance-graph")).toContainText("rules/TX.json");
    await page.getByRole("button", { name: /Close rule value details/ }).click();
    await page.screenshot({ path: `${SHOTS}/v3-rules-1440.png` });
  });

  test("TX 'Use official text' preview shows the quote in its source, the holder warning and the impact; POST without a name is rejected", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const drawer = await openLanguageDrawer(page);
    await drawer.getByTestId("adopt-open").click();
    const dialog = page.getByTestId("adopt-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId("adopt-quote")).toContainText("The notice must include the following language:", { timeout: 30_000 });
    const mark = dialog.getByTestId("adopt-quote").locator("mark");
    await expect(mark).toContainText("You (the holder) are holding the property");
    await expect(dialog.getByTestId("adopt-source-link")).toHaveAttribute("href", "https://claimittexas.gov/docs/96-478.pdf#page=13");
    await expect(dialog.getByTestId("adopt-warning")).toContainText("You (the holder)");
    await expect(dialog.getByTestId("adopt-warning")).toContainText("word for word");
    await expect(dialog.getByTestId("adopt-impact")).toContainText(/TX letter/);
    await expect(dialog.getByTestId("adopt-after")).toContainText("You (the holder) are holding the property");
    // The text is not editable: no textbox holds it.
    await expect(dialog.getByRole("textbox")).toHaveCount(1);
    // F33: the approver name is prefilled from the shared identity; a name too short to record blocks approval with clear copy.
    const name = dialog.getByLabel("Approving as");
    await expect(name).not.toHaveValue("");
    await expect(dialog.getByTestId("adopt-approve")).toBeEnabled();
    expect(await axeBlocking(page)).toEqual([]);
    await page.screenshot({ path: `${SHOTS}/v3-rules-adopt-1440.png` });
    const remembered = await name.inputValue();
    await name.fill("D");
    await expect(dialog.getByTestId("adopt-approve")).toBeDisabled();
    await expect(dialog.getByTestId("adopt-name-required")).toBeVisible();
    await name.fill(remembered); // restore the shared, remembered approver name
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();

    // The server enforces the name too: a blank approver is refused and nothing is written.
    const preview = await page.request.get(`/api/rules/TX/adopt?path=${LANG}`);
    expect(preview.status()).toBe(200);
    const p = (await preview.json()) as { expectedVersion: string; expectedSha256: string; after: { value: string } };
    const body = { path: LANG, expectedVersion: p.expectedVersion, expectedSha256: p.expectedSha256, proposedText: p.after.value };
    for (const approvedBy of ["", " "]) {
      const res = await page.request.post("/api/rules/TX/adopt", { data: { ...body, approvedBy } });
      expect(res.status()).toBe(400);
    }
    const missing = await page.request.post("/api/rules/TX/adopt", { data: body });
    expect(missing.status()).toBe(400);
    expect(readFileSync(TX_RULES, "utf8")).toBe(txBefore);
  });

  test("rules: axe clean with the drawer open, no overflow at 375/1024/1440", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openLanguageDrawer(page);
    await expect(page.getByText(DISCLAIMER)).toBeVisible();
    expect(await axeBlocking(page)).toEqual([]);
    for (const w of [1440, 1024, 375]) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.goto("/rules?state=TX");
      await expect(page.getByTestId("review-toolbar")).toBeVisible({ timeout: 30_000 });
      await expectNoOverflow(page);
      await page.goto(TX_LANG_URL);
      await expect(page.getByTestId("provenance-graph")).toBeVisible({ timeout: 30_000 });
      await expectNoOverflow(page);
    }
    await page.screenshot({ path: `${SHOTS}/v3-rules-375.png` });
  });
});

test.describe("reports", () => {
  test("the warning count matches the shared counter the chat tool uses (R3-11)", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    let generated: { state: string; errors: ValidationError[]; warnings: string[] } | null = null;
    for (const state of ["TX", "DE", "CA"]) {
      const res = await page.request.post("/api/reports", { data: { state } });
      if (res.status() !== 201) continue;
      const j = (await res.json()) as { errors: ValidationError[]; warnings: string[] };
      generated = { state, ...j };
      break;
    }
    test.skip(generated === null, "no state has items to report on this server");
    const { state, errors, warnings } = generated!;
    const expected = summarizeValidation(errors, warnings);
    await page.goto(`/reports?state=${state}`);
    const summary = page.getByTestId("validation-summary");
    await expect(summary).toBeVisible({ timeout: 30_000 });
    if (expected.warningCount > 0) {
      await expect(page.getByTestId("validation-warning-count")).toHaveText(new RegExp(`\\b${expected.warningCount} warnings?$`));
    } else {
      await expect(page.getByTestId("validation-warning-count")).toHaveCount(0);
    }
    if (expected.errorCount > 0) await expect(summary).toContainText(`${expected.errorCount} error`);
    else await expect(summary).toContainText("Passed with no errors");
  });

  test("filing path per state, the stepper, ?filter=approved, axe and no overflow", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/reports");
    await expect(page.getByTestId("report-detail")).toBeVisible({ timeout: 30_000 });
    for (const st of ["CA", "DE", "TX"]) await expect(page.getByTestId(`reports-track-${st}`)).toBeVisible();
    await expect(page.getByTestId("filing-stepper").locator("li")).toHaveCount(5);
    await expect(page.getByText(DISCLAIMER)).toBeVisible();
    expect(await axeBlocking(page)).toEqual([]);
    await page.screenshot({ path: `${SHOTS}/v3-reports-1440.png` });

    await page.goto("/reports?filter=approved");
    await expect(page.getByTestId("reports-filter-note")).toBeVisible({ timeout: 30_000 });

    for (const w of [1440, 1024, 375]) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.goto("/reports");
      await expect(page.getByTestId("filing-stepper")).toBeVisible({ timeout: 30_000 });
      await expectNoOverflow(page);
    }
    await page.screenshot({ path: `${SHOTS}/v3-reports-375.png` });
  });
});

test.describe("replica", () => {
  test("bare /replica/ca redirects to the holder portal; both REPLICA banners and the disclaimer; axe; no overflow", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const res = await page.goto("/replica/ca");
    expect(res?.status()).toBe(200);
    await expect(page).toHaveURL(/\/replica\/ca-holder$/);
    await expect(page.getByTestId("replica-banner-top")).toContainText("REPLICA - NOT A REAL STATE SYSTEM");
    await expect(page.getByTestId("replica-banner-bottom")).toContainText("REPLICA - NOT A REAL STATE SYSTEM");
    await expect(page.getByTestId("disclaimer")).toHaveText(DISCLAIMER);
    await expect(page).toHaveTitle(/^\[REPLICA\]/);
    expect(await axeBlocking(page)).toEqual([]);
    await page.screenshot({ path: `${SHOTS}/v3-replica-1440.png` });
    for (const w of [1024, 375]) {
      await page.setViewportSize({ width: w, height: 812 });
      await page.goto("/replica/tx-search");
      await expect(page.getByTestId("replica-banner-top")).toBeVisible();
      await expectNoOverflow(page);
    }
    await page.goto("/replica/ca-holder");
    await expectNoOverflow(page);
    await page.screenshot({ path: `${SHOTS}/v3-replica-375.png` });
  });
});
