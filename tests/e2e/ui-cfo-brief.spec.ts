/**
 * CFO brief: the Dashboard's "CFO brief (PDF)" button downloads a one-page application/pdf whose text carries the
 * dashboard's own headline total (read from the page, so any seed or clock state works) and the disclaimer; the palette's
 * "Download CFO brief" command downloads the same file. Axe clean on the dashboard, no horizontal overflow at
 * 375/1024/1440. Saves the PDF to .data/shots/cfo-brief/ and the button at 375 and 1440. Read-only.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { PDFDocument } from "pdf-lib";
import { expect, test, type Download, type Page } from "playwright/test";
import { pdfPageTexts } from "../../src/lib/reports/__fixtures__/pdf";

const DISCLAIMER = "Prototype. Not legal advice. Confirm filings with a qualified professional.";
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const SHOTS = ".data/shots/cfo-brief";
const MOD = process.platform === "darwin" ? "Meta" : "Control";

async function open(page: Page, width = 1440) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
  await page.goto("/dashboard", { timeout: 90_000 });
  await expect(page.getByRole("region", { name: "Total exposure" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(DISCLAIMER)).toBeVisible();
  await page.waitForLoadState("networkidle").catch(() => undefined);
}

/** The hero's "Outstanding, not yet filed" figure as printed (reduced motion renders the final number). */
async function heroTotal(page: Page): Promise<string> {
  const region = page.getByRole("region", { name: "Total exposure" });
  let text = "";
  await expect(async () => {
    text = (await region.innerText()).match(/\$[\d,]+\.\d{2}/)?.[0] ?? "";
    expect(text).not.toBe("");
  }).toPass({ timeout: 10_000 });
  return text;
}

async function pdfOf(download: Download): Promise<{ bytes: Uint8Array; pages: number; text: string }> {
  const path = await download.path();
  const bytes = new Uint8Array(readFileSync(path));
  const pages = (await PDFDocument.load(bytes)).getPageCount();
  const [text = ""] = await pdfPageTexts(bytes);
  return { bytes, pages, text };
}

test.describe.configure({ mode: "serial", timeout: 150_000 });
test.beforeAll(() => mkdirSync(SHOTS, { recursive: true }));

test("the dashboard button downloads a one-page PDF with the dashboard total and the disclaimer", async ({ page }) => {
  await open(page);
  const total = await heroTotal(page);
  const button = page.getByTestId("cfo-brief-download");
  await expect(button).toBeVisible();
  await expect(button).toHaveText(/CFO brief \(PDF\)/);

  const head = await page.request.get("/api/cfo-brief.pdf");
  expect(head.status()).toBe(200);
  expect(head.headers()["content-type"]).toBe("application/pdf");

  const [download] = await Promise.all([page.waitForEvent("download"), button.click()]);
  expect(download.suggestedFilename()).toMatch(/^cfo-brief-\d{4}-\d{2}-\d{2}\.pdf$/);
  const pdf = await pdfOf(download);
  expect(pdf.pages).toBe(1);
  expect(pdf.text).toContain(total);
  expect(pdf.text).toContain(DISCLAIMER);
  expect(pdf.text).toContain("Synthetic data");
  expect(pdf.text).toMatch(/Rule versions used: CA /);
  writeFileSync(`${SHOTS}/cfo-brief.pdf`, pdf.bytes);
});

test("the palette's Download CFO brief command downloads the same brief", async ({ page }) => {
  await open(page);
  const total = await heroTotal(page);
  // The Core loop strip (and its next-action pill) sits under the closed "More detail" fold (ASK-MODE slice 5).
  await expect(page.getByTestId("next-action")).toBeAttached();
  const palette = page.getByTestId("command-palette");
  await expect(async () => {
    await page.keyboard.press(`${MOD}+k`);
    await expect(palette).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  await page.keyboard.type("CFO brief");
  const option = palette.getByRole("option", { name: /Download CFO brief/ });
  await expect(option).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent("download"), option.click()]);
  await expect(palette).toBeHidden();
  await expect(page).toHaveURL(/\/dashboard/);
  const pdf = await pdfOf(download);
  expect(pdf.pages).toBe(1);
  expect(pdf.text).toContain(total);
});

test("axe clean on the dashboard and no horizontal overflow at 375/1024/1440", async ({ page }) => {
  for (const width of [375, 1024, 1440] as const) {
    await open(page, width);
    await expect(page.getByTestId("cfo-brief-download")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `overflow at ${width}`).toBeLessThanOrEqual(0);
    const box = await page.getByTestId("cfo-brief-download").boundingBox();
    expect(box && box.x + box.width <= width, `button inside the viewport at ${width}`).toBe(true);
    if (width !== 1024) await page.getByTestId("cfo-brief-row").screenshot({ path: `${SHOTS}/dashboard-button-${width}.png` });
    if (width === 1440) {
      const { violations } = await new AxeBuilder({ page }).setLegacyMode(true).withTags(WCAG_TAGS).analyze();
      const blocking = violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
      expect(blocking).toEqual([]);
    }
  }
});
