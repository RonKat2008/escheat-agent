/**
 * Month-end close pack: /ledger "Close pack" downloads a ZIP with the six expected files (central directory parsed here),
 * the tie-out PDF carries the disclaimer, and the palette has "Month-end close pack: choose a month" (routes to the Ledger picker). Axe clean and no
 * horizontal overflow on /ledger at 375/1024/1440. Screenshots and the pack go to .data/shots/close-pack/. Read-only.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "playwright/test";
import { listZip } from "../../src/lib/close-pack/zip";
import { pdfPageTexts } from "../../src/lib/reports/__fixtures__/pdf";

const DISCLAIMER = "Prototype. Not legal advice. Confirm filings with a qualified professional.";
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const SHOTS = ".data/shots/close-pack";
const MOD = process.platform === "darwin" ? "Meta" : "Control";

async function open(page: Page, width = 1440) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
  await page.goto("/ledger", { timeout: 90_000 });
  await expect(page.getByTestId("close-pack-button")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(DISCLAIMER).first()).toBeVisible();
  await page.waitForLoadState("networkidle").catch(() => undefined);
}

test.describe.configure({ mode: "serial", timeout: 150_000 });
test.beforeAll(() => mkdirSync(SHOTS, { recursive: true }));

test("Close pack downloads a ZIP with the six files and a toast with the count", async ({ page }) => {
  await open(page);
  await expect(page.getByTestId("close-pack-month").locator("option").first()).toBeAttached();
  const month = await page.getByTestId("close-pack-month").inputValue();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("close-pack-button").click()]);
  expect(download.suggestedFilename()).toBe(`escheat-close-pack-${month}.zip`);
  const path = await download.path();
  const bytes = new Uint8Array(readFileSync(path));
  expect(listZip(bytes).map((e) => e.name)).toEqual([
    `journal-${month}.csv`,
    `rollforward-${month}.pdf`,
    "audit-binder.pdf",
    `activity-${month}.csv`,
    `tie-out-${month}.pdf`,
    "manifest.json",
  ]);
  const zipPath = `${SHOTS}/close-pack-${month}.zip`;
  writeFileSync(zipPath, bytes);
  expect(execFileSync("unzip", ["-t", zipPath], { encoding: "utf8" })).toContain("No errors detected");
  await expect(page.getByText("Close pack downloaded: 6 files")).toBeVisible({ timeout: 10_000 });

  const tie = new Uint8Array(execFileSync("unzip", ["-p", zipPath, `tie-out-${month}.pdf`], { maxBuffer: 20_000_000 }));
  const text = (await pdfPageTexts(tie)).join("\n");
  expect(text).toContain("Prototype. Not legal advice.");
  expect(text).toContain("Synthetic data");
  const manifest = JSON.parse(execFileSync("unzip", ["-p", zipPath, "manifest.json"], { encoding: "utf8" })) as { period: string; auditChain: { verified: boolean } };
  expect(manifest.period).toBe(month);
  expect(manifest.auditChain.verified).toBe(true);
  writeFileSync(`${SHOTS}/tie-out-${month}.pdf`, tie);
  await page.screenshot({ path: `${SHOTS}/ledger-1440.png` });
});

test("the palette lists the close pack command", async ({ page }) => {
  await open(page);
  const palette = page.getByTestId("command-palette");
  await expect(async () => {
    await page.keyboard.press(`${MOD}+k`);
    await expect(palette).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  await page.keyboard.type("close pack");
  await expect(palette.getByRole("option", { name: /Month-end close pack: choose a month/ })).toBeVisible();
});

for (const width of [375, 1024, 1440]) {
  test(`/ledger at ${width}px: axe clean, no horizontal overflow`, async ({ page }) => {
    await open(page, width);
    const results = await new AxeBuilder({ page }).setLegacyMode(true).withTags(WCAG_TAGS).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    if (width !== 1440) await page.screenshot({ path: `${SHOTS}/ledger-${width}.png` });
  });
}
