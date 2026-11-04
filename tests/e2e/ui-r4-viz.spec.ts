/**
 * Dogfood round 4, visuals slice (R4-07, R4-08, R4-16, R4-07 map clipping): the Money Flow starts at the stale money,
 * carries a pink Late band with the engine's interest, its bands and cards deep-link into Items, its cards never
 * overlap, phones get stacked bars instead of a vertical Sankey, the Money Map's edge labels stay on screen, and the
 * pink caption matches the bands. Advancing the demo clock morphs the diagram in place (reset afterwards). Axe clean
 * and no horizontal overflow at 375/1024/1440. Screens to .data/shots/r4-viz/.
 */
import { mkdirSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "playwright/test";

const DISCLAIMER = "Prototype. Not legal advice. Confirm filings with a qualified professional.";
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const SHOTS = process.env.R4_SHOTS ?? ".data/shots/r4-viz";
const WIDTHS = [375, 1024, 1440] as const;

const dollars = (s: string): number => Number(s.replace(/[^0-9.]/g, ""));

async function open(page: Page, width = 1440, path = "/dashboard") {
  await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
  await page.goto(path, { timeout: 90_000 });
  await expect(page.getByText(DISCLAIMER)).toBeVisible({ timeout: 30_000 });
}

async function settle(page: Page) {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
}

async function noOverflow(page: Page) {
  const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(o, "horizontal overflow px").toBeLessThanOrEqual(0);
}

async function axeBlocking(page: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page }).setLegacyMode(true).withTags(WCAG_TAGS).analyze();
  return violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
}

/** Visible cards of the desktop diagram, as boxes. */
async function cardBoxes(page: Page) {
  return page.locator("[data-flow-root] [data-flow-node]").evaluateAll((els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect();
      return { id: e.getAttribute("data-flow-node") ?? "", x: r.x, y: r.y, w: r.width, h: r.height, text: (e as HTMLElement).innerText };
    }),
  );
}

test.describe.configure({ mode: "serial", timeout: 150_000 });
test.beforeAll(() => mkdirSync(SHOTS, { recursive: true }));

test("1440: the diagram starts at Stale, leads with a pink Late band, and no two cards overlap", async ({ page }) => {
  await open(page, 1440);
  const flow = page.getByTestId("money-flow");
  await flow.scrollIntoViewIfNeeded();
  await settle(page);
  // No $1.3M ledger block: the ledger is a caption line and the first card is Stale.
  await expect(flow.locator("[data-flow-node=ledger]")).toHaveCount(0);
  await expect(flow.getByTestId("flow-ledger")).toContainText("The diagram follows the stale money");
  const cards = await cardBoxes(page);
  expect(cards[0]?.id).toBe("stale");
  const exposure = dollars((await flow.getByTestId("flow-exposure").textContent()) ?? "");
  const stateSum = cards.filter((c) => c.id.startsWith("state:")).length;
  expect(stateSum).toBeGreaterThan(0);
  const risk = await flow.locator("[data-flow-root] [data-flow-node^='state:']").evaluateAll((els) => els.map((e) => e.textContent ?? ""));
  expect(risk.reduce((a, n) => a + dollars(n.match(/\$[\d,]+\.\d{2}/)![0]), 0)).toBeCloseTo(exposure, 2);

  // Real height for the states and statuses (R4-07): every card is at least 40px and no two overlap.
  for (const c of cards) expect(c.h, `${c.id} height`).toBeGreaterThanOrEqual(40);
  for (let i = 0; i < cards.length; i++)
    for (let j = i + 1; j < cards.length; j++) {
      const a = cards[i]!;
      const b = cards[j]!;
      const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      expect(overlap, `${a.id} overlaps ${b.id}`).toBe(false);
    }

  // Fresh seed has overdue TX items: the Late card carries the engine's interest and agrees with the Overdue panel.
  const late = flow.locator("[data-flow-root] [data-flow-node=late]");
  await expect(late).toBeVisible();
  await expect(late).toContainText("Late + interest");
  await expect(late).toContainText(/\+ ~\$[\d,]+\.\d{2}/);
  const interest = (await page.getByTestId("late-interest").textContent()) ?? "";
  await expect(flow.getByTestId("flow-late")).toContainText(interest.trim());
  await expect(flow.locator("[data-flow-root] [data-flow-band][data-tone=late]").first()).toBeAttached();

  // R4-08: the caption describes the pink that is on screen; a letter awaiting approval turns its band pink.
  const caption = (await flow.locator("p").first().innerText()).replace(/\s+/g, " ");
  const humanBands = await flow.locator("[data-flow-root] [data-flow-band][data-tone=human]").count();
  if (humanBands === 0) expect(caption).not.toContain("letter awaiting approval");
  else expect(caption).toContain("letter awaiting approval");
  const caDd = flow.locator("[data-flow-root] [data-flow-band='state:CA>dd']");
  if ((await caDd.count()) > 0) await expect(caDd).toHaveAttribute("data-tone", "human");

  await noOverflow(page);
  await flow.screenshot({ path: `${SHOTS}/flow-1440.png` });
  await page.screenshot({ path: `${SHOTS}/dashboard-1440.png`, fullPage: true });
});

test("a Late band opens Items filtered to that state's overdue items, with the band's count", async ({ page }) => {
  await open(page, 1440);
  const band = page.locator("[data-flow-root] [data-flow-band^='state:'][data-tone=late]").first();
  await band.scrollIntoViewIfNeeded();
  const name = (await band.getAttribute("aria-label")) ?? "";
  const n = Number(name.match(/, (\d+) items?\./)?.[1]);
  const state = (await band.getAttribute("data-flow-band"))!.match(/^state:([A-Z]+)>/)?.[1];
  expect(n).toBeGreaterThan(0);
  await band.focus();
  await expect(page.getByRole("tooltip")).toContainText("Late");
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/items\?/, { timeout: 60_000 });
  const url = new URL(page.url());
  expect(url.searchParams.get("overdue")).toBe("1");
  expect(url.searchParams.get("state")).toBe(state);
  await expect(page.getByTestId("filter-overdue")).toHaveAttribute("aria-pressed", "true");
  // The list holds exactly the band's items, each flagged overdue.
  await expect(page.getByRole("rowheader", { name: new RegExp(`^Total, ${n} items?$`) })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("[data-testid=overdue-chip]:visible")).toHaveCount(n);
  await page.screenshot({ path: `${SHOTS}/items-from-late-band-1440.png` });
});

test("375: stacked bars instead of a vertical Sankey, tappable segments, map labels inside the screen", async ({ page }) => {
  await open(page, 375);
  const flow = page.getByTestId("money-flow");
  await flow.scrollIntoViewIfNeeded();
  await settle(page);
  await expect(flow.locator("[data-flow-root]")).toBeHidden();
  const bars = flow.locator("[data-flow-bars]").first();
  await expect(bars).toBeVisible();
  await expect(bars.locator("[data-flow-row^='state:']").first()).toBeVisible();
  // Every segment chip is a link with a full name, at least 24px tall, and chips never overlap.
  const chips = await bars.locator("a[data-flow-band]").evaluateAll((els) => els.map((e) => ({ ...e.getBoundingClientRect().toJSON(), href: e.getAttribute("href") })));
  expect(chips.length).toBeGreaterThan(0);
  for (const c of chips) {
    expect(c.height).toBeGreaterThanOrEqual(24);
    expect(c.right).toBeLessThanOrEqual(375);
    expect(c.href).toMatch(/^\/items/);
  }
  for (let i = 0; i < chips.length; i++)
    for (let j = i + 1; j < chips.length; j++) {
      const a = chips[i]!;
      const b = chips[j]!;
      expect(a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom, "chips overlap").toBe(false);
    }
  // Money Map: the CA label (west edge) is not clipped.
  const ca = page.getByTestId("state-tile-CA");
  await ca.scrollIntoViewIfNeeded();
  await settle(page);
  const box = (await ca.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(375);
  // R4-16: an overdue state says "overdue", never "due ≤7d" for an item already late.
  const tx = page.getByTestId("state-tile-TX");
  if ((await page.getByTestId("late-amount").count()) > 0 && (await tx.count()) > 0) await expect(tx).toContainText("overdue");
  await noOverflow(page);
  await flow.screenshot({ path: `${SHOTS}/flow-375.png` });
  await page.screenshot({ path: `${SHOTS}/dashboard-375.png`, fullPage: true });
});

test("R4-16: the deadline counts use one window and one 'soon'", async ({ page }) => {
  await open(page, 1440);
  const strip = page.getByTestId("deadline-strip");
  await strip.scrollIntoViewIfNeeded();
  const sr = (await strip.locator("figcaption").textContent()) ?? "";
  const m = sr.match(/(\d+) deadlines in the next 90 days; (\d+) within 7 days/);
  expect(m, sr).toBeTruthy();
  const panel = page.locator("section", { has: strip }).first();
  const meta = (await panel.innerText()).replace(/\s+/g, " ");
  expect(meta).toContain(`${m![1]} in 90 days`);
  if (Number(m![2]) > 0) expect(meta).toContain(`${m![2]} within 7 days`);
  expect(meta).not.toContain("within 2 weeks");
  await expect(page.getByText("Next legal date")).toHaveCount(0);
});

test.describe("after advancing the demo clock in the app", () => {
  test.afterAll(async ({ request }) => {
    const r = await request.post("/api/clock", { data: { action: "reset" } });
    expect(r.status()).toBeLessThan(300);
  });

  test("the diagram morphs in place to the new figures", async ({ page }) => {
    await open(page, 1440);
    const flow = page.getByTestId("money-flow");
    await flow.scrollIntoViewIfNeeded();
    await settle(page);
    const before = await cardBoxes(page);
    const lateBefore = before.find((c) => c.id === "late")?.text ?? "";
    await page.getByRole("button", { name: /Demo clock/ }).click();
    await page.getByRole("button", { name: "+1y" }).click();
    await expect(page.getByText(/demo date is now/)).toBeVisible({ timeout: 60_000 });
    // Same diagram element, new figures: the Late card's text changes without a navigation.
    await expect(async () => {
      const after = await cardBoxes(page);
      expect(after.find((c) => c.id === "late")?.text ?? "").not.toBe(lateBefore);
    }).toPass({ timeout: 60_000 });
    await settle(page);
    const after = await cardBoxes(page);
    for (let i = 0; i < after.length; i++)
      for (let j = i + 1; j < after.length; j++) {
        const a = after[i]!;
        const b = after[j]!;
        expect(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h, `${a.id} overlaps ${b.id}`).toBe(false);
      }
    await noOverflow(page);
    await flow.screenshot({ path: `${SHOTS}/flow-plus1y-1440.png` });
  });
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });
  test("the flow renders final with no running animations", async ({ page }) => {
    await open(page, 1440);
    await page.getByTestId("money-flow").scrollIntoViewIfNeeded();
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await expect(page.locator("[data-flow-root] [data-flow-node=stale]")).toBeVisible();
    const running = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running" && Number(a.effect?.getTiming().duration) > 1).length);
    expect(running).toBe(0);
    // No morph transition on the cards: a clock change swaps the figures instantly.
    const card = page.locator("[data-flow-root] [data-flow-node=stale]");
    await expect(card).not.toHaveClass(/es-flow-card/);
    const moving = await card.evaluate((e) => {
      const cs = getComputedStyle(e);
      const props = cs.transitionProperty.split(",").map((s) => s.trim());
      const durs = cs.transitionDuration.split(",").map((s) => Number.parseFloat(s));
      return props.some((p, i) => (p === "transform" || p === "all") && (durs[i] ?? durs[0] ?? 0) > 0);
    });
    expect(moving).toBe(false);
  });
});

for (const width of WIDTHS) {
  test(`dashboard @${width}px: axe serious/critical clean, no horizontal overflow`, async ({ page }) => {
    await open(page, width);
    await page.getByTestId("money-flow").scrollIntoViewIfNeeded();
    await settle(page);
    expect(await axeBlocking(page)).toEqual([]);
    await noOverflow(page);
    if (width === 1024) await page.screenshot({ path: `${SHOTS}/dashboard-1024.png`, fullPage: true });
  });
}
