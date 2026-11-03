/**
 * DESIGN-V3 slice 10: bad replica slugs are decided in the proxy (src/app/replica/_lib/replica-gate.ts), so the
 * instant-validated [portal] layout never throws for them. A bare state in any case redirects to its holder portal;
 * anything else 404s with the replica look (both banners and the disclaimer). Read-only.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "playwright/test";

const DISCLAIMER = "Prototype. Not legal advice. Confirm filings with a qualified professional.";

test.describe("replica gate", () => {
  test("a bare state in any case redirects to its holder portal", async ({ page }) => {
    for (const slug of ["CA", "De", "tx"]) {
      await page.goto(`/replica/${slug}`);
      await expect(page).toHaveURL(new RegExp(`/replica/${slug.toLowerCase()}-holder$`));
    }
  });

  test("unknown slugs 404 with both REPLICA banners, the disclaimer, axe clean and no overflow", async ({ page, request }) => {
    for (const path of ["/replica/ny-holder", "/replica/CA-HOLDER", "/replica/ny-holder/upload", "/replica/unknown-portal"]) {
      expect((await request.get(path, { maxRedirects: 0 })).status(), path).toBe(404);
    }
    const res = await page.goto("/replica/ny-holder");
    expect(res?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1, name: "Portal not found" })).toBeVisible();
    await expect(page.getByTestId("replica-banner-top")).toBeVisible();
    await expect(page.getByTestId("replica-banner-bottom")).toBeVisible();
    await expect(page.getByTestId("disclaimer")).toHaveText(DISCLAIMER);
    await expect(page.getByRole("link", { name: "/replica/tx-search" })).toHaveAttribute("href", "/replica/tx-search");

    const { violations } = await new AxeBuilder({ page }).setLegacyMode(true).analyze();
    expect(violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
    for (const width of [375, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `overflow at ${width}px`).toBeLessThanOrEqual(0);
    }
  });
});
