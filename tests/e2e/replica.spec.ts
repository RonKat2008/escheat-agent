import { expect, test } from "playwright/test";
import { buildNaupaFile } from "../../src/lib/replica/portal/naupa-fixture";

const USER = "northwind-demo";
const PASS = "replica-only";

test.describe("replica holder portal", () => {
  test("login -> upload -> summary -> approve -> confirmation", async ({ page }) => {
    await page.goto("/replica/ca-holder");
    await expect(page).toHaveTitle(/^\[REPLICA\]/);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await expect(page.getByTestId("replica-banner-top")).toBeVisible();
    await expect(page.getByTestId("replica-banner-bottom")).toBeVisible();
    await expect(page.getByTestId("disclaimer")).toContainText("Not legal advice");
    await expect(page.getByTestId("demo-credentials")).toContainText(USER);

    // wrong password first
    await page.getByTestId("login-username").fill(USER);
    await page.getByTestId("login-password").fill("wrong");
    await page.getByTestId("login-submit").click();
    await expect(page.getByTestId("login-error")).toBeVisible();

    await page.getByTestId("login-username").fill(USER);
    await page.getByTestId("login-password").fill(PASS);
    await page.getByTestId("login-submit").click();
    await expect(page).toHaveURL(/\/replica\/ca-holder\/dashboard/);

    await page.getByTestId("file-report-link").click();
    await page.getByTestId("naupa-upload").setInputFiles({
      name: "northwind-ca.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(buildNaupaFile()),
    });
    await page.getByTestId("upload-submit").click();

    await expect(page).toHaveURL(/\/replica\/ca-holder\/review\//);
    await expect(page.getByTestId("summary-holder-name")).toHaveText("NORTHWIND FIXTURES INC");
    await expect(page.getByTestId("summary-item-count")).toHaveText("3");
    await expect(page.getByTestId("summary-total")).toHaveText("$2,589.50");
    await expect(page.getByTestId("summary-code-row")).toHaveCount(2);
    await expect(page.getByTestId("summary-no-problems")).toBeVisible();

    await page.getByTestId("approve-submission").click();
    await expect(page.getByTestId("confirmation-number")).toHaveText(/^REPL-CA-\d{4}-[A-Z0-9]{6}$/);
  });

  test("unauthenticated holder pages redirect to login; bad slugs 404", async ({ page, request }) => {
    await page.goto("/replica/tx-holder/upload");
    await expect(page).toHaveURL(/\/replica\/tx-holder$/);
    const res = await request.get("/replica/ny-holder");
    expect(res.status()).toBe(404);
  });

  test("a file with errors cannot be approved", async ({ page }) => {
    await page.goto("/replica/de-holder");
    await page.getByTestId("login-username").fill(USER);
    await page.getByTestId("login-password").fill(PASS);
    await page.getByTestId("login-submit").click();
    await expect(page).toHaveURL(/\/replica\/de-holder\/dashboard/);
    await page.goto("/replica/de-holder/upload");
    await page.getByTestId("naupa-paste").fill(buildNaupaFile({ suminfoCents: 1 }));
    await page.getByTestId("upload-submit").click();
    await expect(page.getByTestId("summary-problems")).toBeVisible();
    await expect(page.getByTestId("approve-submission")).toHaveCount(0);
  });
});

test.describe("replica search portal", () => {
  test("search -> claim -> confirmation (TX finds the $1,180 Northwind record)", async ({ page }) => {
    await page.goto("/replica/tx-search");
    await page.getByTestId("search-name").fill("Northwind Fixtures, Inc.");
    await page.getByTestId("search-submit").click();
    const rows = page.getByTestId("result-row");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("$1,180.00");
    await page.getByTestId("claim-button").click();
    await page.getByTestId("claim-business-name").fill("Northwind Fixtures, Inc.");
    await page.getByTestId("claim-contact").fill("ap@northwind.example");
    await page.getByTestId("claim-submit").click();
    await expect(page.getByTestId("claim-confirmation")).toHaveText(/^REPL-CLM-TX-\d{4}-[A-Z0-9]{6}$/);
  });

  test("CA and DE do not list the Northwind record", async ({ page }) => {
    for (const st of ["ca", "de"]) {
      await page.goto(`/replica/${st}-search`);
      await page.getByTestId("search-name").fill("Northwind Fixtures, Inc.");
      await page.getByTestId("search-submit").click();
      await expect(page.getByTestId("no-results")).toBeVisible();
    }
  });
});
