/**
 * What-if simulator (/what-if), "ui" group. Read-only feature: every test checks or relies on nothing being written.
 * Every figure is compared against what the app shows right now, never a fresh-seed constant: all ui specs share one
 * database and earlier ones leave clock jumps, filings and responses behind. Screenshots land in .data/shots/what-if/.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "playwright/test";

const WIDTHS = [375, 1024, 1440] as const;
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const DISCLAIMER = "Prototype. Not legal advice. Confirm filings with a qualified professional.";
const NOTE = "Simulation. Nothing is saved or sent. Dates come from the rules engine.";
const SHOTS = ".data/shots/what-if";

async function openWhatIf(page: Page, query = ""): Promise<void> {
  await page.goto(`/what-if${query}`);
  await expect(page.getByRole("heading", { name: "What-if", level: 1 })).toBeVisible();
  await expect(page.getByTestId("what-if")).toBeVisible({ timeout: 30_000 });
}

const cents = async (page: Page, testId: string, attr = "data-cents") => Number(await page.getByTestId(testId).getAttribute(attr));
/** Horizontal overflow in px, with the widest offenders named so a failure says what to fix. */
async function overflow(page: Page): Promise<{ px: number; offenders: string[] }> {
  return page.evaluate(() => {
    const px = document.documentElement.scrollWidth - window.innerWidth;
    const offenders =
      px <= 0
        ? []
        : [...document.querySelectorAll("body *")]
            .filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1)
            .slice(-6)
            .map((e) => `${e.tagName.toLowerCase()}.${String(e.getAttribute("class") ?? "").slice(0, 80)} [${e.getAttribute("data-testid") ?? ""}] right=${Math.round(e.getBoundingClientRect().right)}`);
    return { px, offenders };
  });
}

/** Same device pin the landing spec uses: a CI runner has <= 4 cores, which is the "lite" tier, and the timeline only tilts at "full". */
async function pinCapableHardware(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, "hardwareConcurrency", { get: () => 8, configurable: true });
    Object.defineProperty(Navigator.prototype, "deviceMemory", { get: () => 8, configurable: true });
  });
}

const usd = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Clock + full CSV exports of the ledger and the activity feed: any write would change one of them. */
async function fingerprint(page: Page): Promise<string> {
  const [clock, ledger, activity] = await Promise.all([page.request.get("/api/clock"), page.request.get("/api/ledger.csv"), page.request.get("/api/activity.csv")]);
  expect(clock.status()).toBe(200);
  expect(ledger.status()).toBe(200);
  expect(activity.status()).toBe(200);
  const c = (await clock.json()) as { today: string; offsetDays: number };
  return JSON.stringify({ today: c.today, offset: c.offsetDays, ledger: await ledger.text(), activity: await activity.text() });
}

test.describe("what-if simulator", () => {
  test.use({ reducedMotion: "reduce" });

  test("offset 0 matches the dashboard exposure; the simulation copy and disclaimer show", async ({ page }) => {
    await page.goto("/dashboard");
    const hero = page.getByRole("region", { name: "Total exposure" });
    await expect(hero).toContainText("$", { timeout: 30_000 });
    const dashboard = /\$[\d,]+\.\d{2}/.exec((await hero.textContent()) ?? "")?.[0];
    expect(dashboard).toBeTruthy();

    await openWhatIf(page);
    expect(usd(await cents(page, "wi-exposure"))).toBe(dashboard);
    await expect(page.getByTestId("wi-exposure")).toContainText(dashboard!);
    await expect(page.getByTestId("wi-exposure-delta")).toHaveText("no change vs today");
    await expect(page.getByTestId("wi-note")).toHaveText(NOTE);
    await expect(page.locator("footer")).toContainText(DISCLAIMER);
    // DE's interest rule states a monthly rate the engine does not model: UNKNOWN, with a labelled known subtotal.
    await expect(page.getByTestId("wi-interest")).toHaveAttribute("data-cents", "unknown");
    await expect(page.getByTestId("wi-interest-known")).toContainText("UNKNOWN, not guessed");
    await expect(page.getByTestId("wi-interest").getByTestId("unverified-badge")).toBeVisible();
  });

  test("+365 days misses more deadlines than today; dragging reveals pink missed marks", async ({ page }) => {
    await openWhatIf(page);
    const today = await cents(page, "wi-missed", "data-count");
    await page.getByRole("button", { name: "+1y" }).click();
    await expect(page.getByTestId("what-if")).toHaveAttribute("data-offset", "365");
    await expect(page).toHaveURL(/[?&]d=365/);
    await expect.poll(() => cents(page, "wi-missed", "data-count")).toBeGreaterThan(today);
    expect(Number(await page.getByTestId("wi-missed").getAttribute("data-delta"))).toBeGreaterThan(0);
    await expect(page.locator("[data-testid='wi-mark'][data-state='missed']").first()).toBeVisible();
    expect(Number(await page.getByTestId("wi-cross-report_due").textContent())).toBeGreaterThan(0);

    // The slider is keyboard operable; Home goes back to today and hides future marks.
    const slider = page.getByRole("slider", { name: "Days forward" });
    await slider.focus();
    await page.keyboard.press("Home");
    await expect(page.getByTestId("wi-offset")).toContainText("+0 days");
    await expect(page.getByTestId("what-if")).toHaveAttribute("data-offset", "0");
    expect(await cents(page, "wi-missed", "data-count")).toBe(today);

    // Pointer drag on the track moves the cursor too.
    const box = (await page.getByTestId("wi-track-frame").boundingBox())!;
    await page.mouse.move(box.x + 20, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 14, box.y + box.height / 2, { steps: 6 });
    await page.mouse.up();
    await expect.poll(async () => Number(await page.getByTestId("what-if").getAttribute("data-offset"))).toBeGreaterThan(600);
  });

  test("an owner responding lowers exposure by exactly that item's amount", async ({ page }) => {
    await openWhatIf(page);
    const before = await cents(page, "wi-exposure");
    // An item that is open right now (no scenario applied) with money on it and a check number to search by; which one
    // that is depends on what earlier specs left behind, so it is picked from the live list, never assumed.
    const row = page.locator("[data-testid='wi-item-row'][data-scenario='none']:not([data-check='']):not([data-cents='0'])").first();
    await expect(row).toBeVisible();
    const amount = Number(await row.getAttribute("data-cents"));
    const check = (await row.getAttribute("data-check"))!;
    const id = (await row.getAttribute("data-id"))!;
    const picked = page.locator(`[data-testid='wi-item-row'][data-id='${id}']`);

    await page.getByLabel("Find items").fill(check);
    await expect(picked).toBeVisible();
    await picked.getByRole("checkbox").check();
    await page.getByTestId("wi-apply-paid").click();

    await expect.poll(() => cents(page, "wi-exposure")).toBe(before - amount);
    expect(await cents(page, "wi-exposure", "data-delta")).toBe(-amount);
    await expect(picked).toHaveAttribute("data-scenario", "paid");
    await expect(page).toHaveURL(new RegExp(`[?&]paid=${id}`));

    // Back to "No response" restores the figure.
    await picked.getByRole("checkbox").check();
    await page.getByTestId("wi-apply-none").click();
    await expect.poll(() => cents(page, "wi-exposure")).toBe(before);
  });

  test("the URL round-trips the scenario, and Reset to today clears it", async ({ page, context }) => {
    await openWhatIf(page);
    const id = (await page.getByTestId("wi-item-row").first().getAttribute("data-id"))!;
    await openWhatIf(page, `?d=200&paid=${id}&file=CA`);
    await expect(page.getByTestId("what-if")).toHaveAttribute("data-offset", "200");
    await expect(page.getByTestId("wi-state-CA").getByRole("button", { name: "File & remit on due date" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(`[data-testid='wi-item-row'][data-id='${id}']`)).toHaveAttribute("data-scenario", "paid");
    await expect(page.getByTestId("wi-chip-ca-now")).toHaveAttribute("aria-pressed", "true");
    const exposure = await cents(page, "wi-exposure");
    const missed = await cents(page, "wi-missed", "data-count");

    // Change it in the UI, then open the address in a fresh tab: same numbers.
    await page.getByTestId("wi-state-TX").getByRole("button", { name: "File & remit on due date" }).click();
    await expect(page).toHaveURL(/file=CA(%2C|,)TX/);
    const url = page.url();
    const exposure2 = await cents(page, "wi-exposure");
    const other = await context.newPage();
    await openWhatIf(other, url.slice(url.indexOf("?")));
    await expect.poll(() => cents(other, "wi-exposure")).toBe(exposure2);
    await expect(other.getByTestId("wi-state-TX").getByRole("button", { name: "File & remit on due date" })).toHaveAttribute("aria-pressed", "true");
    await other.close();
    expect(exposure2).toBeLessThanOrEqual(exposure);
    expect(missed).toBeGreaterThanOrEqual(0);

    await page.getByTestId("wi-reset").click();
    await expect(page.getByTestId("what-if")).toHaveAttribute("data-offset", "0");
    await expect.poll(() => new URL(page.url()).search).toBe("");
    await expect(page.getByTestId("wi-chip-nothing")).toHaveAttribute("aria-pressed", "true");
  });

  test("the demo clock and the data are unchanged after simulating", async ({ page }) => {
    const before = await fingerprint(page);
    await openWhatIf(page, "?d=730&file=CA,TX,DE");
    await page.getByTestId("wi-chip-largest-respond").click();
    await page.getByRole("button", { name: "+90d" }).click();
    await expect(page.getByTestId("what-if")).toHaveAttribute("data-offset", "90");
    await page.reload();
    await expect(page.getByTestId("what-if")).toBeVisible({ timeout: 30_000 });
    expect(await fingerprint(page)).toBe(before);
    await expect(page.getByTestId("demo-date")).toHaveAttribute("data-date", JSON.parse(before).today);
  });

  test("forecast links to the simulator", async ({ page }) => {
    await page.goto("/forecast");
    await page.getByRole("link", { name: "Try a what-if →" }).click();
    await expect(page).toHaveURL(/\/what-if$/);
    await expect(page.getByTestId("what-if")).toBeVisible({ timeout: 30_000 });
  });

  test("reduced motion: flat timeline, no transitions", async ({ page }) => {
    await openWhatIf(page, "?d=365");
    await expect(page.getByTestId("wi-timeline").locator("[data-tier]").first()).toHaveAttribute("data-tier", "static");
    // The global reduced-motion stylesheet collapses durations to ~0 (1e-05s), never a visible tween.
    const duration = await page.getByTestId("wi-mark").first().evaluate((e) => parseFloat(getComputedStyle(e).transitionDuration));
    expect(duration).toBeLessThan(0.01);
  });

  for (const width of WIDTHS) {
    test(`no horizontal overflow and axe serious/critical clean at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await openWhatIf(page, "?d=365&file=CA");
      const o = await overflow(page);
      expect(o.px, `overflow at ${width}px: ${o.offenders.join(" ; ")}`).toBeLessThanOrEqual(0);
      const { violations } = await new AxeBuilder({ page }).setLegacyMode(true).withTags(WCAG_TAGS).analyze();
      const blocking = violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")})`);
      expect(blocking, `what-if @ ${width}px: serious/critical axe violations`).toEqual([]);
      await page.screenshot({ path: `${SHOTS}/what-if-static-${width}.png`, fullPage: true });
    });
  }
});

test.describe("what-if simulator (motion allowed)", () => {
  test.use({ reducedMotion: "no-preference" });

  for (const width of [375, 1440] as const) {
    test(`tilted timeline with no overflow at ${width}px`, async ({ page }) => {
      await pinCapableHardware(page);
      await page.setViewportSize({ width, height: 900 });
      await openWhatIf(page, "?d=400");
      const tier = page.getByTestId("wi-timeline").locator("[data-tier]").first();
      const webgl2 = await page.evaluate(() => !!document.createElement("canvas").getContext("webgl2"));
      // The tier needs WebGL2 on top of capable hardware. A browser without it honestly stays static (as on the landing spec).
      if (webgl2) await expect(tier).not.toHaveAttribute("data-tier", "static");
      else await expect(tier).toHaveAttribute("data-tier", "static");
      const o = await overflow(page);
      expect(o.px, `overflow at ${width}px: ${o.offenders.join(" ; ")}`).toBeLessThanOrEqual(0);
      await page.screenshot({ path: `${SHOTS}/what-if-3d-${width}.png`, fullPage: true, animations: "disabled" });
    });
  }
});
