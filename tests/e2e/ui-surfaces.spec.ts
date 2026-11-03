/**
 * Polish of the three most-used surfaces ("ui" group): /dashboard, /items (table + item drawer) and /approvals.
 * Covers: reduced motion renders everything final; no horizontal overflow at 375/1024/1280/1440 with the drawer open
 * and closed; axe serious/critical clean; CLS < 0.1 on /dashboard and /items with motion on; the drawer timeline's
 * today marker, folded derivations and single numbered Sources list; the dashboard strip tooltips, featured progress
 * rail and Needs-you panel; j/k detail transitions and grouped safety checks in Approvals.
 *
 * Read-only: nothing here approves, drafts or sends. Deterministic waits only (elements, attributes, animations).
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "playwright/test";

const DISCLAIMER = "Prototype. Not legal advice. Confirm filings with a qualified professional.";
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const WIDTHS = [375, 1024, 1280, 1440] as const;
/** Elements that carry entrance motion; under reduced motion each must be final (no transform, full opacity). */
const MOTION_SELECTOR =
  ".es-iv-grow-x, .es-iv-grow-y, .es-iv-fade, .es-stagger, .es-pop-in, .es-rise, .es-grow-x, .es-grow-y, .es-wipe, .es-detail-in, .es-bar-in, .es-stamp, .es-disclose";

const SURFACES = [
  { name: "dashboard", path: "/dashboard", ready: (p: Page) => p.getByRole("region", { name: "Total exposure" }) },
  { name: "items", path: "/items", ready: (p: Page) => p.locator("tbody tr[data-row-id]").first() },
  { name: "items drawer", path: "/items?item=10482", ready: (p: Page) => p.getByTestId("item-timeline") },
  { name: "approvals", path: "/approvals", ready: (p: Page) => p.locator("[data-key]").first() },
] as const;

async function open(page: Page, s: (typeof SURFACES)[number]) {
  await page.goto(s.path);
  await expect(s.ready(page)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(DISCLAIMER)).toBeVisible();
}

async function settle(page: Page) {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.evaluate(async () => {
    for (let y = 0; y <= document.documentElement.scrollHeight; y += 300) {
      window.scrollTo(0, y);
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    }
    window.scrollTo(0, 0);
  });
  // Infinite loops (the dashboard's flow particles, full tier only) never finish: wait only for finite animations.
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
}

async function motionOffenders(page: Page): Promise<string[]> {
  return page.evaluate((sel) => {
    const bad: string[] = [];
    for (const el of document.querySelectorAll<Element>(sel)) {
      const cs = getComputedStyle(el);
      if (cs.transform !== "none" || cs.opacity !== "1" || cs.animationName !== "none" || (cs.clipPath !== "none" && cs.clipPath !== "")) {
        bad.push(`${el.tagName.toLowerCase()}.${String(el.getAttribute("class")).slice(0, 60)} t=${cs.transform} o=${cs.opacity} a=${cs.animationName} c=${cs.clipPath}`);
      }
    }
    return bad;
  }, MOTION_SELECTOR);
}

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  for (const s of SURFACES) {
    test(`${s.name}: everything renders final with no running animations`, async ({ page }) => {
      await open(page, s);
      await page.waitForLoadState("networkidle").catch(() => undefined);
      expect(await motionOffenders(page)).toEqual([]);
      const running = await page.evaluate(
        () => document.getAnimations().filter((a) => a.playState === "running" && Number(a.effect?.getTiming().duration) > 1).length,
      );
      expect(running).toBe(0);
    });
  }

  test("dashboard: the state bar and the featured lifecycle rail are fully drawn without scrolling", async ({ page }) => {
    await open(page, SURFACES[0]);
    expect(await page.getByTestId("state-bar").evaluate((el) => getComputedStyle(el).clipPath)).toBe("none");
    // V3: the featured check uses the core LifecycleRail; under reduced motion it renders final (no running draw).
    const rail = page.getByTestId("featured-timeline").locator("svg").first();
    await expect(rail).toBeVisible();
    expect(await rail.evaluate((el) => el.getAnimations({ subtree: true }).filter((a) => a.playState === "running").length)).toBe(0);
  });
});

test.describe("layout and accessibility", () => {
  test.use({ reducedMotion: "reduce" });

  for (const s of SURFACES) {
    for (const width of WIDTHS) {
      test(`${s.name} @${width}px: no horizontal overflow, axe serious/critical clean`, async ({ page }) => {
        await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
        await open(page, s);
        await page.evaluate(() => document.fonts.ready);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
        const { violations } = await new AxeBuilder({ page }).setLegacyMode(true).withTags(WCAG_TAGS).analyze();
        const blocking = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
        expect(blocking.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
      });
    }
  }
});

test.describe("layout stability with motion on", () => {
  for (const s of [SURFACES[0], SURFACES[1]]) {
    for (const width of [375, 1440] as const) {
      test(`${s.name} @${width}px: cumulative layout shift stays under 0.1`, async ({ page }) => {
        await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
        await page.addInitScript(() => {
          const w = window as unknown as { __cls: number };
          w.__cls = 0;
          new PerformanceObserver((list) => {
            for (const e of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) if (!e.hadRecentInput) w.__cls += e.value;
          }).observe({ type: "layout-shift", buffered: true });
        });
        await open(page, s);
        await settle(page);
        expect(await page.evaluate(() => (window as unknown as { __cls: number }).__cls)).toBeLessThan(0.1);
      });
    }
  }
});

test.describe("item drawer timeline", () => {
  test("a today marker splits past from future; derivations are folded; sources are listed once and numbered", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, SURFACES[2]);
    const timeline = page.getByTestId("item-timeline");
    const today = timeline.getByTestId("timeline-today");
    await expect(today).toHaveCount(1);
    await expect(today).toContainText("Today");

    // Every node before the marker is in the past, every dated node after it is today or later.
    const order = await timeline.locator("ol > li").evaluateAll((lis) =>
      lis.map((li) => (li.getAttribute("data-testid") === "timeline-today" ? "TODAY" : (li.querySelector("time")?.getAttribute("datetime") ?? ""))),
    );
    const at = order.indexOf("TODAY");
    const asOf = (await today.locator("time").getAttribute("datetime"))!;
    expect(order.slice(0, at).filter(Boolean).every((d) => d < asOf)).toBe(true);
    expect(order.slice(at + 1).filter(Boolean).every((d) => d >= asOf)).toBe(true);

    // One plain line per date is visible; the derivation is behind a closed disclosure until asked for.
    const node = timeline.locator('[data-node="presumed_abandoned"]');
    await expect(node).toContainText("Dormancy period under the owner state's law ends");
    const derivation = node.getByTestId("node-derivation");
    await expect(derivation).toBeHidden();
    await node.getByTestId("node-rules").locator("summary").click();
    await expect(derivation).toBeVisible();
    await expect(derivation).toContainText("3-year dormancy");

    // Sources: one list, numbered 1..n, unique URLs, and every in-node reference points at an entry in it.
    const sources = timeline.getByTestId("timeline-sources");
    await expect(sources).toBeVisible();
    const entries = await sources.locator("li").evaluateAll((lis) => lis.map((li) => ({ id: li.id, href: li.querySelector("a")?.getAttribute("href") ?? "" })));
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.map((e) => e.id)).toEqual(entries.map((_, i) => `tl-src-${i + 1}`));
    expect(new Set(entries.map((e) => e.href)).size).toBe(entries.length);
    expect(await timeline.locator("a[href^='http']").count()).toBe(entries.length);
    const refs = await timeline.locator("a[href^='#tl-src-']").evaluateAll((as) => as.map((a) => a.getAttribute("href")!.slice(1)));
    expect(refs.length).toBeGreaterThan(0);
    for (const r of refs) expect(entries.map((e) => e.id)).toContain(r);
  });

  test("keyboard: the disclosure opens with Enter and the drawer still closes with Escape", async ({ page }) => {
    await open(page, SURFACES[2]);
    const summary = page.getByTestId("item-timeline").locator('[data-node="report_due"]').getByTestId("node-rules").locator("summary");
    await summary.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("item-timeline").locator('[data-node="report_due"]').getByTestId("node-derivation")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("item-drawer")).toBeHidden();
  });
});

test.describe("items table", () => {
  test("a total row sums the listed rows and matches the footer", async ({ page }) => {
    await open(page, SURFACES[1]);
    const totalRow = page.getByTestId("items-total-row");
    await expect(totalRow).toBeVisible();
    const rows = await page.locator("tbody tr[data-row-id]").count();
    await expect(totalRow).toContainText(`Total, ${rows} item`);
    const amount = (await totalRow.locator("td.text-right").innerText()).trim();
    await expect(page.getByTestId("items-footer")).toContainText(amount);
  });

  test("the selected row gets the blue rail; checked rows get a wash; the selection bar enters", async ({ page }) => {
    await open(page, SURFACES[1]);
    await expect(async () => {
      await page.getByTestId("row-select").first().click();
      await expect(page.getByTestId("bulk-bar")).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
    const first = page.locator("tbody tr[data-row-id]").first();
    await expect(first).toHaveAttribute("data-checked", "true");
    expect(await first.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
    await page.locator("body").click({ position: { x: 1, y: 1 } });
    await page.keyboard.press("j");
    await expect(first).toHaveAttribute("data-selected", "true");
    await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));
    const rail = await first.locator("td").first().evaluate((el) => getComputedStyle(el, "::before").transform);
    expect(["none", "matrix(1, 0, 0, 1, 0, 0)"]).toContain(rail);
    await page.getByTestId("bulk-clear").click();
    await expect(page.getByTestId("bulk-bar")).toBeHidden();
  });
});

test.describe("dashboard", () => {
  test("Needs you leads with one primary action; the deadline strip explains a day on focus", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, SURFACES[0]);
    const needs = page.getByTestId("needs-you");
    await expect(needs.getByRole("heading", { name: "Needs you" })).toBeVisible();
    // Exactly one solid primary call to action in the panel.
    // Compare against the --color-blue-600 token as the browser computes it (it may serialize oklch, not rgb).
    const primaries = await needs.locator("a").evaluateAll((as) => {
      const probe = document.createElement("span");
      probe.style.backgroundColor = "var(--color-blue-600)";
      document.body.appendChild(probe);
      const primary = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return as.filter((a) => getComputedStyle(a).backgroundColor === primary).length;
    });
    expect(primaries).toBe(1);

    const strip = page.getByTestId("deadline-strip");
    await strip.scrollIntoViewIfNeeded();
    const day = strip.locator("[tabindex='0']").first();
    await expect(day).toContainText(/deadline/);
    // The Base UI tooltip popup is not exposed as role=tooltip (shared ui/tooltip; core follow-up), so also match the
    // open popup by its state attributes.
    const tip = page.getByRole("tooltip").or(page.locator("[data-base-ui-focusable][data-open][data-side]")).first();
    await expect(async () => {
      // Keyboard focus is the documented way in (and is steadier on CI than hovering a 3px-wide bar). Blur first so
      // each retry is a fresh focus event.
      await page.locator("body").focus();
      await day.focus();
      // Base UI's tooltip opens on :focus-visible, which programmatic focus does not reliably set; arrive by keyboard.
      await page.keyboard.press("Shift+Tab");
      await page.keyboard.press("Tab");
      await expect(tip).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 15_000 });
    await expect(tip).toContainText(/deadline/);
    await expect(tip).toContainText(/\$[\d,]+\.\d{2}/);
  });

  test("the featured check shows how far along it is, with a Today pin", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, SURFACES[0]);
    const tl = page.getByTestId("featured-timeline");
    await tl.scrollIntoViewIfNeeded();
    await expect(tl).toBeVisible();
    // V3 LifecycleRail: the today marker is an SVG instrument label, and the figure names today's (demo) date.
    await expect(tl.getByText("TODAY", { exact: true }).first()).toBeAttached();
    await expect(tl.getByRole("figure")).toHaveAccessibleName(/today is/);
  });

  test("a missing interest rule reads as a known gap with a next step, not an italic Unknown", async ({ page }) => {
    await open(page, SURFACES[0]);
    const gap = page.getByTestId("interest-gap");
    test.skip((await gap.count()) === 0, "every state has an interest rule in this database");
    await expect(gap).toContainText("No total yet");
    await expect(gap.getByRole("link", { name: /in Rules/ })).toHaveAttribute("href", "/rules");
    expect(await gap.locator("p").first().evaluate((el) => getComputedStyle(el).fontStyle)).toBe("normal");
  });
});

test.describe("approvals", () => {
  test("j/k move the detail with a short transition and focus its heading; checks are grouped by outcome", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, SURFACES[3]);
    const rows = page.locator("[data-key]");
    test.skip((await rows.count()) < 2, "needs two queue entries");
    await rows.first().click();
    const detail = page.getByTestId("approval-detail");
    await expect(detail).toBeVisible();
    await page.locator("body").click({ position: { x: 1, y: 1 } });
    const before = await rows.nth(1).getAttribute("data-key");
    await page.keyboard.press("j");
    await expect(rows.nth(1)).toHaveAttribute("aria-current", "true");
    expect(before).toBeTruthy();
    await expect(detail).toHaveClass(/es-detail-in/);
    await expect(detail.locator("[data-detail-heading]")).toBeFocused();
    await page.keyboard.press("k");
    await expect(rows.first()).toHaveAttribute("aria-current", "true");

    const checks = detail.getByTestId("safety-checks");
    if (await checks.count()) {
      await expect(checks.getByRole("heading", { name: /Passed/ })).toBeVisible();
      const levels = await checks.locator("[data-check]").evaluateAll((els) => els.map((e) => e.getAttribute("data-check")));
      expect(levels.length).toBeGreaterThan(0);
    }
  });
});
