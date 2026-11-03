/**
 * DESIGN-V3 slice 3 (Items + Payees), "ui" group: keyboard triage and the Loop Bar views, the item drawer's lifecycle
 * tunnel (and its flat rail under reduced motion) with "Why this date?", the bulk-draft dry-run preview, F29 (the drawer
 * shows a new draft immediately), R3-19 (phone deadlines, footer never over the last row), the payee merge name (F33),
 * axe and no horizontal overflow at 375/1024/1440. Screenshots: .data/shots/v3-items-*.png and v3-payees-*.png.
 * In order: the F29 test drafts one letter and the bulk test drafts letters; the ui server re-seeds on every run.
 */
import { mkdirSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "playwright/test";

const DISCLAIMER = "Prototype. Not legal advice. Confirm filings with a qualified professional.";
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const SHOTS = ".data/shots";
const ROWS = "tbody tr[data-row-id]";

async function axeBlocking(page: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page }).setLegacyMode(true).withTags(WCAG_TAGS).analyze();
  return violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
}

async function overflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

async function settle(page: Page) {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));
}

async function openItems(page: Page, path = "/items") {
  await page.goto(path);
  await expect(page.locator(ROWS).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(DISCLAIMER)).toBeVisible();
}

/** The list key handler attaches on hydration: press j until the first row is marked active. */
async function hydratedList(page: Page) {
  await expect(async () => {
    await page.locator("body").click({ position: { x: 1, y: 1 } });
    await page.keyboard.press("j");
    await expect(page.locator(ROWS).first()).toHaveAttribute("data-selected", "true", { timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
}

// One worker runs these in file order (F29 drafts before the bulk test); a failure does not skip the rest.
test.describe.configure({ mode: "default" });
test.beforeAll(() => mkdirSync(SHOTS, { recursive: true }));

test.describe("items: views and keyboard triage", () => {
  test("Loop Bar views: Needs action and Draft-ready match the bar's Triage and Draft counts", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openItems(page, "/items?view=needs-action");
    await expect(page.getByTestId("view-needs-action")).toHaveAttribute("aria-current", "page");
    const triage = Number(await page.getByTestId("loop-count-triage").textContent());
    await expect(page.getByTestId("view-count-needs-action")).toHaveText(String(triage));
    await expect(page.locator(ROWS)).toHaveCount(triage);
    await expect(page.getByTestId("items-footer")).toContainText(`${triage} ${triage === 1 ? "item" : "items"}`);

    await page.goto("/items?view=draft-ready");
    await expect(page.getByTestId("view-draft-ready")).toHaveAttribute("aria-current", "page");
    const draft = Number(await page.getByTestId("loop-count-draft").textContent());
    await expect(page.getByTestId("view-count-draft-ready")).toHaveText(String(draft));
    if (draft > 0) await expect(page.locator(ROWS)).toHaveCount(draft);
  });

  test("j/k move, x selects, Shift+↓ extends, / focuses search, Enter opens the drawer, Escape closes it", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openItems(page);
    await hydratedList(page);
    const rows = page.locator(ROWS);
    await page.keyboard.press("j");
    await expect(rows.nth(1)).toHaveAttribute("data-selected", "true");
    await page.keyboard.press("k");
    await expect(rows.nth(0)).toHaveAttribute("data-selected", "true");
    await page.keyboard.press("x");
    await expect(rows.nth(0)).toHaveAttribute("data-checked", "true");
    await page.keyboard.press("Shift+ArrowDown");
    await expect(rows.nth(1)).toHaveAttribute("data-checked", "true");
    await expect(page.getByTestId("bulk-count")).toHaveText("2");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("bulk-bar")).toBeHidden();

    await page.keyboard.press("/");
    await expect(page.getByTestId("items-search")).toBeFocused();
    await page.locator("body").click({ position: { x: 1, y: 1 } });

    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/item=/);
    await expect(page.getByTestId("item-drawer")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("item-drawer")).toBeHidden();
  });

  test("state ribbon filters by state and the Overdue filter is kept", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openItems(page);
    const ribbon = page.getByTestId("state-ribbon");
    await expect(ribbon).toBeVisible();
    await expect(async () => {
      await page.getByTestId("ribbon-TX").click();
      await expect(page).toHaveURL(/state=TX/, { timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
    await expect(page.getByTestId("ribbon-TX")).toHaveAttribute("aria-pressed", "true");
    // aria-pressed follows the URL at once; the rows follow the server round trip.
    await expect
      .poll(async () => (await page.locator(`${ROWS} td:nth-child(4)`).allInnerTexts()).every((s) => s.trim() === "TX"), { timeout: 30_000 })
      .toBe(true);
    await expect(page.getByTestId("filter-overdue")).toBeVisible();
  });
});

test.describe("items: drawer lifecycle", () => {
  test("defaults to the Rail on desktop, and 3D is an opt-in toggle", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/items?item=10482");
    const drawer = page.getByTestId("item-drawer");
    await expect(drawer.getByTestId("item-lifecycle")).toHaveAttribute("data-view", "rail", { timeout: 30_000 });
    await expect(drawer.getByTestId("lifecycle-tunnel")).toHaveCount(0);
    await drawer.getByRole("radio", { name: "3D" }).click();
    await expect(drawer.getByTestId("item-lifecycle")).toHaveAttribute("data-view", "3d");
    await expect(drawer.getByTestId("lifecycle-tunnel")).toBeVisible({ timeout: 20_000 });
  });

  test("3D tunnel: rings in depth, j/k flies the camera, Why this date shows rule, source and UNVERIFIED", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("es-lifecycle-view", "3d"));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/items?item=10482");
    const drawer = page.getByTestId("item-drawer");
    await expect(drawer).toContainText("Bayline Electric", { timeout: 30_000 });
    const tunnel = drawer.getByTestId("lifecycle-tunnel");
    await expect(tunnel).toBeVisible({ timeout: 20_000 });
    await expect(tunnel.getByTestId("tunnel-ring")).toHaveCount(7);
    // Rings recede: each later ring sits deeper (translateZ more negative).
    const zs = await tunnel.getByTestId("tunnel-ring").evaluateAll((els) =>
      els.map((el) => ({ key: el.getAttribute("data-ring"), z: Number(/translateZ\((-?[\d.]+)px\)/.exec((el as HTMLElement).style.transform)?.[1]) })),
    );
    const byKey = Object.fromEntries(zs.map((r) => [r.key, r.z]));
    expect(byKey.issued).toBe(0);
    expect(byKey.remit_due!).toBeLessThan(byKey.report_due!);

    const why = drawer.getByTestId("why-this-date");
    await expect(why).toBeVisible();
    const startKey = await why.getAttribute("data-key");
    const startFocus = Number(await tunnel.getAttribute("data-focus"));
    await tunnel.getByRole("group", { name: /Lifecycle tunnel/ }).focus();
    const dir = startFocus >= 6 ? "k" : "j";
    await page.keyboard.press(dir);
    await expect(tunnel).toHaveAttribute("data-focus", String(startFocus + (dir === "j" ? 1 : -1)));
    await expect(why).not.toHaveAttribute("data-key", startKey ?? "");
    // The drawer stayed on the same item: the tunnel owns j/k while focused.
    await expect(page).toHaveURL(/item=10482/);

    // Pick the report date: value -> rule path -> sources, with the UNVERIFIED badge from the rule file.
    await tunnel.getByTestId("tunnel-stage").filter({ hasText: "Report due" }).click();
    await expect(why).toHaveAttribute("data-key", "report_due");
    await expect(why.getByTestId("why-step")).toContainText(/Oct 31/);
    await expect(why.getByTestId("why-rules")).toContainText(/\w+\.\w+/);
    await expect(why.getByTestId("why-sources").locator("a[href^='http']").first()).toBeVisible();
    await expect(why.getByTestId("why-verification")).toBeVisible();
    await expect(drawer.getByTestId("unverified-badge").first()).toBeVisible();
    // The detailed date list (existing contract) is still there.
    await expect(drawer.getByTestId("item-timeline")).toContainText("Business threshold, not law");

    await settle(page);
    await page.screenshot({ path: `${SHOTS}/v3-items-drawer-tunnel-1440.png` });
    expect(await axeBlocking(page)).toEqual([]);

    await drawer.getByRole("radio", { name: "Rail" }).click();
    await expect(drawer.getByTestId("item-lifecycle")).toHaveAttribute("data-view", "rail");
    await expect(drawer.getByRole("figure", { name: "Lifecycle" })).toBeVisible();
    await expect(drawer.getByTestId("lifecycle-tunnel")).toHaveCount(0);
    await settle(page);
    await page.screenshot({ path: `${SHOTS}/v3-items-drawer-rail-1440.png` });
  });

  test.describe("reduced motion", () => {
    test.use({ reducedMotion: "reduce" });
    test("the flat rail replaces the tunnel and nothing keeps animating", async ({ page }) => {
      await page.addInitScript(() => localStorage.setItem("es-lifecycle-view", "3d"));
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto("/items?item=10482");
      const drawer = page.getByTestId("item-drawer");
      await expect(drawer.getByTestId("item-lifecycle")).toBeVisible({ timeout: 30_000 });
      await expect(drawer.getByTestId("lifecycle-flat-note")).toBeVisible();
      await expect(drawer.getByTestId("lifecycle-tunnel")).toHaveCount(0);
      await expect(drawer.getByRole("figure", { name: "Lifecycle" })).toBeVisible();
      await expect(drawer.getByTestId("why-this-date")).toBeVisible();
      await page.waitForLoadState("networkidle").catch(() => undefined);
      const running = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running" && Number(a.effect?.getTiming().duration) > 1).length);
      expect(running).toBe(0);
    });
  });

  test("phone: the drawer defaults to the rail and fits 375px", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/items?item=10482");
    const drawer = page.getByTestId("item-drawer");
    await expect(drawer.getByTestId("item-lifecycle")).toHaveAttribute("data-view", "rail", { timeout: 30_000 });
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await settle(page);
    await page.screenshot({ path: `${SHOTS}/v3-items-drawer-375.png` });
    expect(await axeBlocking(page)).toEqual([]);
  });
});

test.describe("items: drafting", () => {
  test("F29: drafting from the drawer shows the new outreach at once (never 'No outreach yet')", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    // Independent of test order: put the demo clock back on the anchor date (another spec may have advanced it), then
    // ask the server's dry run which listed items can be drafted instead of guessing from the seed.
    const reset = await page.request.post("/api/clock", { data: { action: "reset" } });
    expect(reset.ok(), `clock reset: ${reset.status()}`).toBe(true);
    // Drafting is refused before an item's due-diligence window opens (R4-03), and the few items open on the anchor
    // date are drafted by other specs. Move past Oct 31, 2028, when the bulk of the seed's windows open; reset after.
    const advanced = await page.request.post("/api/clock", { data: { action: "advance_to", date: "2028-11-01" } });
    expect(advanced.ok(), `clock advance_to: ${advanced.status()}`).toBe(true);
    try {
    await openItems(page, "/items");
    const ids = await page.locator(ROWS).evaluateAll((rows) => rows.map((r) => r.getAttribute("data-row-id") ?? "").filter(Boolean));
    const dry = await page.request.post("/api/outreach/bulk-draft", { data: { channel: "letter", staleItemIds: ids.slice(0, 50), dryRun: true } });
    expect(dry.ok(), `dry run: ${dry.status()}`).toBe(true);
    const { plan } = (await dry.json()) as { plan: { staleItemId: string; decision: string }[] };
    // #10087 is the demo path's draftable item (open window, address on file); dry-run picks follow as fallbacks.
    const candidates = ["10087", ...plan.filter((p) => p.decision === "will_draft").map((p) => p.staleItemId)];
    const drawer = page.getByTestId("item-drawer");
    let drafted = false;
    for (const id of candidates.slice(0, 8)) {
      await page.goto(`/items?item=${id}`);
      await expect(drawer).toBeVisible({ timeout: 30_000 });
      await expect(drawer.getByTestId("item-lifecycle")).toBeVisible({ timeout: 30_000 });
      if ((await drawer.getByText(/No outreach yet/).count()) === 0) continue;
      await drawer.getByRole("button", { name: "Draft outreach" }).click();
      const outcome = await Promise.race([
        drawer.getByRole("link", { name: "Review in approvals" }).waitFor({ timeout: 60_000 }).then(() => "drafted" as const),
        drawer.getByTestId("draft-refused").waitFor({ timeout: 60_000 }).then(() => "refused" as const),
      ]);
      if (outcome === "drafted") {
        drafted = true;
        break;
      }
      // A refusal (200, drafted:false) is shown plainly; try the next candidate.
      await expect(drawer.getByTestId("draft-refused")).toContainText("Not drafted:");
    }
    expect(drafted, "found an item that could be drafted").toBe(true);
    await expect(drawer.getByText(/No outreach yet/)).toHaveCount(0);
    await expect(drawer.getByTestId("outreach-list")).toContainText(/letter/i);
    // After the refresh the stored row replaces the optimistic one and stays.
    await expect(drawer.locator("[data-testid=outreach-list] li[data-outreach-id]").first()).toBeVisible();
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await expect(drawer.getByText(/No outreach yet/)).toHaveCount(0);
    } finally {
      await page.request.post("/api/clock", { data: { action: "reset" } });
    }
  });

  test("bulk draft: d opens a dry-run preview with skip reasons; nothing is written until Confirm", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const posts: { url: string; dry: boolean }[] = [];
    page.on("request", (r) => {
      if (r.method() === "POST" && r.url().includes("/api/outreach/bulk-draft")) posts.push({ url: r.url(), dry: (r.postData() ?? "").includes('"dryRun":true') });
    });
    // TX notice language is UNKNOWN in the rule file, so TX rows are skipped with a rule reason.
    await openItems(page, "/items?state=TX");
    await hydratedList(page);
    const n = Math.min(5, await page.locator(ROWS).count());
    for (let i = 0; i < n; i++) {
      await page.keyboard.press("x");
      if (i < n - 1) await page.keyboard.press("j");
    }
    await expect(page.getByTestId("bulk-count")).toHaveText(String(n));
    await page.keyboard.press("d");
    const preview = page.getByTestId("bulk-draft-preview");
    await expect(preview).toBeVisible({ timeout: 30_000 });
    const m = (await preview.getByRole("heading").first().innerText()).match(/^(\d+) will be drafted, (\d+) skipped$/);
    expect(m).not.toBeNull();
    const [will, skipped] = [Number(m![1]), Number(m![2])];
    expect(will + skipped).toBe(n);
    expect(skipped).toBeGreaterThan(0);
    const groups = preview.getByTestId("bulk-skip-group");
    expect(await groups.count()).toBeGreaterThan(0);
    await expect(groups.first()).toContainText(/skipped/);
    await expect(preview).toContainText(/unknown|not open|Already|closed|address/i);
    expect(posts.length).toBeGreaterThan(0);
    expect(posts.every((p) => p.dry)).toBe(true);
    await settle(page);
    await page.screenshot({ path: `${SHOTS}/v3-items-bulk-preview-1440.png` });
    expect(await axeBlocking(page)).toEqual([]);

    // Cancel writes nothing.
    await preview.getByTestId("bulk-preview-cancel").click();
    await expect(preview).toBeHidden();
    expect(posts.every((p) => p.dry)).toBe(true);

    // Confirm runs the real (non-dry) request for the will-draft items only.
    await page.getByTestId("bulk-draft").click();
    await expect(preview).toBeVisible({ timeout: 30_000 });
    const confirm = preview.getByTestId("bulk-preview-confirm");
    if (will === 0) {
      await expect(confirm).toBeDisabled();
      return;
    }
    await confirm.click();
    const results = page.getByTestId("bulk-draft-results");
    await expect(results).toBeVisible({ timeout: 30_000 });
    await expect(results).toContainText("Nothing has been sent");
    expect(posts.some((p) => !p.dry)).toBe(true);
  });
});

test.describe("items: phone layout (R3-19)", () => {
  test("rows show their deadline, long names wrap, the footer never covers the last row", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openItems(page);
    const first = page.locator(ROWS).first();
    await expect(first.getByTestId("row-deadline-phone")).toBeVisible();
    const names = await page.locator(`${ROWS} button[aria-label^="Open "]`).evaluateAll((els) => els.map((el) => getComputedStyle(el).textOverflow));
    expect(names.every((t) => t !== "ellipsis")).toBe(true);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(200);
    const geo = await page.evaluate(() => {
      const rows = document.querySelectorAll("tbody tr[data-row-id]");
      const last = rows[rows.length - 1]!.getBoundingClientRect();
      const footer = document.querySelector("[data-testid=items-footer-bar]")!.getBoundingClientRect();
      return { lastBottom: last.bottom, footerTop: footer.top };
    });
    expect(geo.lastBottom).toBeLessThanOrEqual(geo.footerTop + 0.5);
    await page.evaluate(() => window.scrollTo(0, 0));
    await settle(page);
    await page.screenshot({ path: `${SHOTS}/v3-items-375.png` });
  });
});

test.describe("payees", () => {
  test("merge review: the name field is pre-filled (F33), the diff shows, and the merge is recorded", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/payees");
    await expect(page.getByTestId("payee-row").first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(DISCLAIMER)).toBeVisible();
    await settle(page);
    await page.screenshot({ path: `${SHOTS}/v3-payees-1440.png` });

    const dialog = page.getByTestId("payee-change-dialog");
    const button = page.getByTestId("review-pair").first().getByRole("button", { name: /Review merge/ });
    await expect(async () => {
      await button.click();
      await expect(dialog).toBeVisible({ timeout: 1_500 });
    }).toPass({ timeout: 20_000 });
    await expect(dialog.getByTestId("payee-diff-summary")).toBeVisible({ timeout: 20_000 });
    const name = dialog.getByTestId("payee-change-name");
    await expect(name).not.toHaveValue("");
    expect((await name.inputValue()).trim().length).toBeGreaterThanOrEqual(2);
    await expect(dialog.getByTestId("payee-change-name-required")).toHaveCount(0);
    await expect(dialog.getByTestId("payee-change-confirm")).toBeEnabled();
    await settle(page);
    await page.screenshot({ path: `${SHOTS}/v3-payees-merge-1440.png` });
    expect(await axeBlocking(page)).toEqual([]);

    await name.fill("Slice Three Reviewer");
    await dialog.getByTestId("payee-change-confirm").click();
    await expect(page.getByTestId("payee-notice")).toContainText("recorded as a human decision", { timeout: 30_000 });
  });

  test("payee drawer shows the alias cluster", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/payees?show=aliases");
    const row = page.getByTestId("payee-row").first();
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(async () => {
      await row.getByRole("button", { name: /^Open / }).click();
      await expect(page.getByTestId("payee-drawer")).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
    const cluster = page.getByTestId("alias-cluster");
    await expect(cluster).toBeVisible();
    await expect(cluster.locator("svg g[data-basis]").first()).toBeAttached();
    await settle(page);
    await page.screenshot({ path: `${SHOTS}/v3-payees-drawer-1440.png` });
    expect(await axeBlocking(page)).toEqual([]);
  });
});

test.describe("layout and accessibility", () => {
  test.use({ reducedMotion: "reduce" });
  const PAGES = [
    { name: "items", path: "/items", ready: (p: Page) => p.locator(ROWS).first() },
    { name: "items-needs-action", path: "/items?view=needs-action", ready: (p: Page) => p.getByTestId("view-needs-action") },
    { name: "items-overdue", path: "/items?overdue=1", ready: (p: Page) => p.getByTestId("filter-overdue") },
    { name: "payees", path: "/payees", ready: (p: Page) => p.getByTestId("payee-row").first() },
  ] as const;
  for (const s of PAGES) {
    for (const width of [375, 1024, 1440] as const) {
      test(`${s.name} @${width}px: no horizontal overflow, axe clean`, async ({ page }) => {
        await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
        await page.goto(s.path);
        await expect(s.ready(page)).toBeVisible({ timeout: 30_000 });
        await expect(page.getByText(DISCLAIMER)).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        expect(await overflow(page)).toBeLessThanOrEqual(0);
        expect(await axeBlocking(page)).toEqual([]);
        if ((s.name === "items" || s.name === "payees") && width !== 1024) {
          await settle(page);
          await page.screenshot({ path: `${SHOTS}/v3-${s.name}-${width}.png` });
        }
      });
    }
  }
});
