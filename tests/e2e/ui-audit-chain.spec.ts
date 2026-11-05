/**
 * Tamper-evident audit chain on /activity: after a demo reset and a +30 day clock move the chain holds real events,
 * verifies, and the JSON download carries the same head hash as the badge. Axe clean, no horizontal overflow at
 * 375/1024/1440. Screenshots land in .data/shots/audit-chain/.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "playwright/test";

test.use({ reducedMotion: "reduce" });
test.describe.configure({ mode: "serial" });

const SHOTS = ".data/shots/audit-chain";
const badge = (page: Page) => page.getByTestId("audit-chain-badge");

test.beforeAll(async ({ request }) => {
  const reset = await request.post("/api/demo/reset", { data: { confirm: true }, timeout: 180_000 });
  expect(reset.status(), await reset.text()).toBe(200);
  const move = await request.post("/api/clock", { data: { action: "advance", days: 30 } });
  expect(move.status(), await move.text()).toBe(200);
});

test.afterAll(async ({ request }) => {
  const res = await request.post("/api/clock", { data: { action: "reset" } });
  expect(res.status(), await res.text()).toBe(200);
});

test("Activity shows 'Chain verified' with real events, and the JSON download has the same head", async ({ page }) => {
  await page.goto("/activity");
  await expect(badge(page)).toBeVisible();
  await expect(badge(page)).toHaveAttribute("data-ok", "true");
  await expect(badge(page)).toContainText(/Chain verified · \d+ events · head [0-9a-f]{4}…[0-9a-f]{4}/);
  const length = Number(await badge(page).getAttribute("data-length"));
  expect(length).toBeGreaterThanOrEqual(2);
  const head = (await badge(page).getAttribute("data-head")) ?? "";
  expect(head).toMatch(/^[0-9a-f]{64}$/);
  await expect(badge(page)).toContainText(`${head.slice(0, 4)}…${head.slice(-4)}`);

  await badge(page).click();
  const popover = page.getByTestId("audit-chain-popover");
  await expect(popover).toBeVisible();
  await expect(popover).toContainText("recomputes all");
  await expect(popover).toContainText(head);
  await page.screenshot({ path: `${SHOTS}/popover-1440.png` });

  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("audit-chain-download").click()]);
  const path = await download.path();
  const { readFile } = await import("node:fs/promises");
  const json = JSON.parse(await readFile(path, "utf8")) as {
    verification: { ok: boolean; length: number; headHash: string };
    rows: { seq: number; kind: string; hash: string }[];
  };
  expect(json.verification).toMatchObject({ ok: true, length, headHash: head });
  expect(json.rows.at(-1)!.hash).toBe(head);
  expect(json.rows.map((r) => r.seq)).toEqual(json.rows.map((_, i) => i + 1));
  const kinds = json.rows.map((r) => r.kind);
  expect(kinds).toContain("ingestion.ledger");
  expect(kinds).toContain("clock.move");
  expect(kinds.at(-1)).toBe("clock.move");

  const csv = await page.request.get("/api/activity.csv?kind=clock");
  expect(csv.headers()["x-audit-chain-head"]).toBe(head);
  expect((await csv.text()).split("\r\n")[1]).toContain(head);
});

for (const [name, width, height] of [
  ["375", 375, 812],
  ["1024", 1024, 768],
  ["1440", 1440, 900],
] as const) {
  test(`chain badge: no horizontal overflow and axe clean at ${name}px`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/activity");
    await expect(badge(page)).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    const { violations } = await new AxeBuilder({ page }).setLegacyMode(true).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    const blocking = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(blocking.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);

    await badge(page).click();
    await expect(page.getByTestId("audit-chain-popover")).toBeVisible();
    const popOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(popOverflow).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `${SHOTS}/activity-${width}.png` });
  });
}
