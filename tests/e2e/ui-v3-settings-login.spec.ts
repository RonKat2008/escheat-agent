/**
 * DESIGN-V3 slice 8 (settings + login), "ui" group (passcode-gated server):
 *   - /login: the ≥1024 split (vault-floor outline + 360px form), the error state (alert, aria wiring, pink-500 border)
 *   - /settings/integrations: the connection diagram shows the honest status from the server's config read (the e2e
 *     server sets no provider keys, so nothing may claim to be connected), the R3-16 test recipient is explicit and
 *     masked, and the Reduce motion preference writes the same es-motion key the command palette uses
 *   - R3-14: no raw env-var names visible outside a collapsed "Technical details" disclosure
 *   - R3-18: /settings redirects through a route handler (the dev log check is in the run notes)
 *   - axe (legacy mode) and no horizontal overflow at 375/1024/1440. Writes .data/shots/v3-{login,settings}-{1440,375}.png.
 */
import { mkdirSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "playwright/test";
import { E2E_SECRETS } from "./env";

const DISCLAIMER = "Prototype. Not legal advice. Confirm filings with a qualified professional.";
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const SHOTS = ".data/shots";
const WIDTHS = [375, 1024, 1440] as const;
const CONFIG_NAME = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g;
const OFFLINE = ["1", "true", "yes", "on"].includes((process.env.ESCHEAT_OFFLINE ?? "").toLowerCase());

test.use({ reducedMotion: "reduce" });

async function axeBlocking(page: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page }).setLegacyMode(true).withTags(WCAG_TAGS).analyze();
  return violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
}

async function noOverflow(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
}

async function setWidth(page: Page, width: number) {
  await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
}

/** Resolves a design token to sRGB bytes by painting it, so oklch tokens compare with computed colors. */
async function rgbOf(page: Page, css: string): Promise<number[]> {
  return page.evaluate((c) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = c;
    ctx.fillRect(0, 0, 1, 1);
    return Array.from(ctx.getImageData(0, 0, 1, 1).data.slice(0, 3));
  }, css);
}

async function expectToken(page: Page, locator: Locator, prop: string, token: string) {
  const tokenCss = await page.evaluate((t) => {
    const s = document.createElement("span");
    s.style.color = `var(${t})`;
    document.body.append(s);
    const v = getComputedStyle(s).color;
    s.remove();
    return v;
  }, token);
  const want = await rgbOf(page, tokenCss);
  await expect
    .poll(async () => {
      const got = await rgbOf(page, await locator.evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop));
      return got.every((v, i) => Math.abs(v - (want[i] ?? -999)) <= 2);
    })
    .toBe(true);
}

/** Visible text only: closed <details> content is not rendered, so it is not in innerText. */
async function visibleConfigNames(page: Page): Promise<string[]> {
  const text = await page.evaluate(() => document.body.innerText);
  return [...new Set(text.match(CONFIG_NAME) ?? [])];
}

test.describe("login", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("split layout at 1440, stacked at 375, disclaimer and no config text", async ({ page }) => {
    mkdirSync(SHOTS, { recursive: true });
    await setWidth(page, 1440);
    await page.goto("/login");
    await expect(page.getByTestId("login-split")).toBeVisible();
    await expect(page.getByTestId("login-art")).toBeVisible();
    await expect(page.getByTestId("vault-silhouette")).toBeAttached();
    // The silhouette is shape only: no numbers or money on the login screen.
    expect(await page.getByTestId("login-art").innerText()).toBe("");
    expect(await page.evaluate(() => document.body.innerText)).not.toMatch(/\$\s?\d/);
    const panel = page.getByTestId("login-form-panel");
    expect((await panel.boundingBox())?.width).toBeLessThanOrEqual(360.5);
    const [artBox, panelBox] = [await page.getByTestId("login-art").boundingBox(), await panel.boundingBox()];
    expect(artBox!.x + artBox!.width).toBeLessThanOrEqual(panelBox!.x);
    await expect(page.getByText(DISCLAIMER)).toBeVisible();
    expect(await visibleConfigNames(page)).toEqual([]);
    await noOverflow(page);
    expect(await axeBlocking(page)).toEqual([]);

    await setWidth(page, 375);
    await expect(page.getByTestId("login-art")).toBeHidden();
    await expect(page.getByLabel("Passcode")).toBeVisible();
    await expect(page.getByText(DISCLAIMER)).toBeVisible();
    await noOverflow(page);
  });

  test("error state: announced, wired, pink-500 border, refocused, fits at every width", async ({ page }) => {
    await setWidth(page, 1440);
    await page.goto("/login");
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
    const input = page.getByLabel("Passcode");
    await input.fill("definitely-wrong-v3");
    await page.getByRole("button", { name: "Enter" }).click();

    const alert = page.locator("#passcode-error");
    await expect(alert).toHaveText("Incorrect passcode.");
    await expect(alert).toHaveAttribute("role", "alert");
    await expect(input).toHaveAttribute("aria-invalid", "true");
    await expect(input).toHaveAttribute("aria-describedby", "passcode-error");
    await expect(input).toBeFocused();
    await expect(input).toHaveValue("");
    await expectToken(page, input, "border-top-color", "--color-pink-500");
    await page.screenshot({ path: `${SHOTS}/v3-login-1440.png` });

    for (const width of WIDTHS) {
      await setWidth(page, width);
      await expect(alert).toBeVisible();
      await noOverflow(page);
      expect(await axeBlocking(page), `login error @${width}`).toEqual([]);
    }
    await setWidth(page, 375);
    await page.screenshot({ path: `${SHOTS}/v3-login-375.png`, fullPage: true });
  });
});

test.describe("settings", () => {
  test("/settings lands on integrations", async ({ page }) => {
    const res = await page.request.get("/settings", { maxRedirects: 0 });
    expect(res.status()).toBe(307);
    expect(res.headers().location).toMatch(/\/settings\/integrations$/);
    await page.goto("/settings");
    await expect(page).toHaveURL(/\/settings\/integrations$/);
    await expect(page.getByRole("heading", { name: "Integrations", level: 1 })).toBeVisible();
  });

  test("connection diagram shows honest statuses from the server config", async ({ page }) => {
    mkdirSync(SHOTS, { recursive: true });
    await setWidth(page, 1440);
    await page.goto("/settings/integrations");
    const diagram = page.getByTestId("connection-diagram");
    await expect(diagram).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("connection-hub")).toBeAttached();

    // The e2e server sets no provider keys (scripts/e2e-server.ts), so nothing may read as connected or set up.
    const outbound = OFFLINE ? "offline" : "not-configured";
    const expected: Record<string, string> = {
      qbo: "not-configured",
      plaid: "not-configured",
      csv: "available",
      lob: outbound,
      agentmail: outbound,
      vapi: outbound,
      anthropic: outbound,
      inngest: "local",
    };
    for (const [id, status] of Object.entries(expected)) {
      await expect(page.getByTestId(`connection-node-${id}`), id).toHaveAttribute("data-status", status);
    }
    await expect(diagram.locator("[data-link='live']")).toHaveCount(1); // only CSV upload, which needs no setup
    await expect(diagram.getByText("Connected", { exact: true })).toHaveCount(0);

    // Rows below the diagram carry the same statuses in words.
    await expect(page.getByTestId("service-row-lob").getByTestId("service-status")).toHaveAttribute("data-status", outbound);
    await expect(page.getByTestId("service-row-inngest").getByTestId("service-status")).toHaveText("Local dev mode");

    // R3-16: the email recipient is explicit, labelled "test recipient", and masked (never the raw inbox address).
    const recipient = page.getByTestId("test-recipient");
    await expect(recipient).toContainText(/test recipient/i);
    await expect(page.getByTestId("test-recipient-address")).toHaveText("de…@example.com");
    expect(await page.evaluate(() => document.body.innerText)).not.toContain(E2E_SECRETS.ALLOWED_TEST_RECIPIENTS);

    await expect(page.getByText(DISCLAIMER)).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/v3-settings-1440.png`, fullPage: true });
  });

  test("R3-14: config names only inside a collapsed Technical details disclosure, never a secret", async ({ page }) => {
    await page.goto("/settings/integrations");
    await expect(page.getByTestId("owner-link-notices")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: /Drop a CSV here/ })).toBeVisible();
    expect(await visibleConfigNames(page)).toEqual([]);

    // The owner-link notice reads in plain words; opening its disclosure reveals the setting's name, not its value.
    const notices = page.getByTestId("owner-link-notices");
    await expect(notices).toContainText("Owner reply links");
    const disclosure = notices.getByTestId("technical-details").first();
    await disclosure.locator("summary").click();
    await expect(disclosure).toContainText("OWNER_LINK_SECRET");
    expect(await page.evaluate(() => document.body.innerText)).not.toContain(E2E_SECRETS.OWNER_LINK_SECRET);
  });

  test("Reduce motion toggles the shared es-motion preference", async ({ page }) => {
    await page.goto("/settings/integrations");
    const group = page.getByRole("radiogroup", { name: "Reduce motion" });
    await expect(group).toBeVisible();
    const pref = page.getByTestId("pref-reduce-motion");
    await expect(pref).toHaveAttribute("data-value", "system");

    await group.getByRole("radio", { name: "On" }).click();
    await expect(pref).toHaveAttribute("data-value", "reduce");
    expect(await page.evaluate(() => localStorage.getItem("es-motion"))).toBe("reduce");
    await expect(page.locator("html")).toHaveAttribute("data-motion", "reduce");

    // Survives a reload (the root layout applies it before paint).
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-motion", "reduce");
    await expect(page.getByRole("radio", { name: "On" })).toHaveAttribute("aria-checked", "true");

    await page.getByRole("radiogroup", { name: "Reduce motion" }).getByRole("radio", { name: "System" }).click();
    await expect(pref).toHaveAttribute("data-value", "system");
    expect(await page.evaluate(() => localStorage.getItem("es-motion"))).toBeNull();
    await expect(page.locator("html")).not.toHaveAttribute("data-motion", "reduce");
  });

  test("axe clean and no horizontal overflow at 375/1024/1440", async ({ page }) => {
    mkdirSync(SHOTS, { recursive: true });
    await page.goto("/settings/integrations");
    await expect(page.getByTestId("connection-diagram")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("owner-link-notices")).toBeVisible();
    for (const width of WIDTHS) {
      await setWidth(page, width);
      await noOverflow(page);
      expect(await axeBlocking(page), `settings @${width}`).toEqual([]);
    }
    await setWidth(page, 375);
    await page.screenshot({ path: `${SHOTS}/v3-settings-375.png`, fullPage: true });
  });
});
