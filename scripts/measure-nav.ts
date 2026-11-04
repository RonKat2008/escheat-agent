/**
 * Navigation speed probe (docs/perf/2026-11-04-navigation.md). Run against a PRODUCTION server (`next build` +
 * `next start`; dev compiles on demand and says nothing about shipped navigation):
 *   tsx scripts/measure-nav.ts http://localhost:3941 [rounds=3] [passcode]
 *
 * Two numbers per app route:
 *   - server: a plain GET with the session cookie. TTFB = static shell flushed; total = last streamed byte, i.e. the
 *     full server render including every dynamic (DB) hole.
 *   - client: clicking the sidebar link at 1440px, from the click until (a) the new page's h1 is in <main> ("shell")
 *     and (b) no `aria-busy="true"` skeleton is left in <main> ("content").
 * Medians over `rounds` passes through the nav in sidebar order (each click starts from the previous page).
 */
import { chromium, type Page } from "playwright";
import { E2E_UI_PASSCODE } from "../tests/e2e/env";

interface Route {
  path: string;
  /** Present in the sidebar (client nav measured); server time is measured for every route. */
  nav: boolean;
}

const ROUTES: readonly Route[] = [
  { path: "/dashboard", nav: true },
  { path: "/items", nav: true },
  { path: "/payees", nav: true },
  { path: "/approvals", nav: true },
  { path: "/forecast", nav: true },
  { path: "/activity", nav: true },
  { path: "/rules", nav: true },
  { path: "/reports", nav: true },
  { path: "/recoveries", nav: true },
  { path: "/chat", nav: true },
  { path: "/runs", nav: true },
  { path: "/eval", nav: true },
  { path: "/settings/integrations", nav: true },
  { path: "/close-out/CA", nav: false },
];

const CONTENT_TIMEOUT_MS = 20_000;

const median = (xs: number[]) => {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] ?? NaN) : ((s[mid - 1] ?? NaN) + (s[mid] ?? NaN)) / 2;
};

async function signIn(page: Page, passcode: string) {
  await page.goto("/login", { waitUntil: "load" });
  for (let attempt = 1; ; attempt++) {
    await page.getByLabel("Passcode").fill(passcode);
    await page.getByRole("button", { name: "Enter" }).click();
    try {
      await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 5_000 });
      return;
    } catch (err) {
      if (attempt >= 4) throw err;
    }
  }
}

async function serverTiming(base: string, path: string, cookie: string) {
  const t0 = performance.now();
  const res = await fetch(base + path, { headers: { cookie }, redirect: "manual" });
  const ttfb = performance.now() - t0;
  await res.text();
  return { ttfb, total: performance.now() - t0, status: res.status };
}

interface NavMarks {
  click?: number;
  h1?: number;
  content?: number;
  skeleton?: boolean;
}

/**
 * Timed inside the page (performance.now at the click's capture phase, then a MutationObserver), so Playwright's own
 * actionability checks and polling are not counted.
 */
async function clickNav(page: Page, path: string) {
  await page.evaluate((p) => {
    const w = window as unknown as { __nav: NavMarks };
    const marks: NavMarks = {};
    w.__nav = marks;
    const prev = document.querySelector("main h1")?.textContent ?? "";
    document.addEventListener("click", () => (marks.click = performance.now()), { capture: true, once: true });
    const check = () => {
      if (location.pathname !== p) return;
      const h1 = document.querySelector("main h1");
      if (marks.h1 === undefined && h1 && (h1.textContent ?? "") !== prev) marks.h1 = performance.now();
      if (marks.h1 === undefined) return;
      if (document.querySelector('main [aria-busy="true"]')) marks.skeleton = true;
      else if (marks.content === undefined) {
        marks.content = performance.now();
        mo.disconnect();
      }
    };
    const mo = new MutationObserver(check);
    mo.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
  }, path);
  await page.locator(`aside nav[aria-label="Main navigation"] a[href="${path}"]`).first().click();
  await page.waitForFunction(() => (window as unknown as { __nav: NavMarks }).__nav.content !== undefined, undefined, {
    polling: "raf",
    timeout: CONTENT_TIMEOUT_MS,
  });
  const m = await page.evaluate(() => (window as unknown as { __nav: NavMarks }).__nav);
  const click = m.click ?? 0;
  return { shell: (m.h1 ?? 0) - click, content: (m.content ?? 0) - click, skeleton: Boolean(m.skeleton) };
}

async function main() {
  const base = process.argv[2] ?? "http://localhost:3941";
  const rounds = Number(process.argv[3] ?? 3);
  const passcode = process.argv[4] ?? E2E_UI_PASSCODE;

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ baseURL: base, viewport: { width: 1440, height: 900 } });
  // tsx (esbuild keepNames) wraps named closures in __name(); give evaluated functions a no-op one.
  await ctx.addInitScript({ content: "window.__name = (f) => f;" });
  const page = await ctx.newPage();
  await signIn(page, passcode);
  const cookie = (await ctx.cookies()).map((c) => `${c.name}=${c.value}`).join("; ");

  // Warm every route once on the server (first hit compiles nothing in prod, but PGlite pages in its data).
  for (const r of ROUTES) await serverTiming(base, r.path, cookie);

  const server: Record<string, { ttfb: number[]; total: number[] }> = {};
  for (let i = 0; i < rounds; i++) {
    for (const r of ROUTES) {
      const t = await serverTiming(base, r.path, cookie);
      const acc = (server[r.path] ??= { ttfb: [], total: [] });
      acc.ttfb.push(t.ttfb);
      acc.total.push(t.total);
    }
  }

  const client: Record<string, { shell: number[]; content: number[]; skeletons: number }> = {};
  const navRoutes = ROUTES.filter((r) => r.nav);
  // Start on the last nav page so the first click (dashboard) is a real navigation.
  await page.goto(navRoutes.at(-1)?.path ?? "/runs", { waitUntil: "networkidle" });
  for (let i = 0; i < rounds; i++) {
    for (const r of navRoutes) {
      const t = await clickNav(page, r.path);
      const acc = (client[r.path] ??= { shell: [], content: [], skeletons: 0 });
      acc.shell.push(t.shell);
      acc.content.push(t.content);
      if (t.skeleton) acc.skeletons += 1;
      // Let prefetches for the newly mounted page settle, like a person reading it.
      await page.waitForLoadState("networkidle");
    }
  }
  await browser.close();

  const f = (n: number) => (Number.isNaN(n) ? "n/a" : String(Math.round(n)));
  console.log("| Route | Click → h1 (ms) | Click → content (ms) | Skeleton shown | Server TTFB (ms) | Server full render (ms) |");
  console.log("|---|---:|---:|---:|---:|---:|");
  for (const r of ROUTES) {
    const c = client[r.path];
    const s = server[r.path] ?? { ttfb: [], total: [] };
    console.log(
      `| ${r.path} | ${c ? f(median(c.shell)) : "n/a (not in nav)"} | ${c ? f(median(c.content)) : "n/a"} | ${c ? `${c.skeletons}/${c.content.length}` : "n/a"} | ${f(median(s.ttfb))} | ${f(median(s.total))} |`,
    );
  }
  const allContent = Object.values(client).flatMap((c) => c.content);
  const allShell = Object.values(client).flatMap((c) => c.shell);
  console.log(`\nmedian click→h1 ${f(median(allShell))} ms · median click→content ${f(median(allContent))} ms · max click→content ${f(Math.max(...allContent))} ms`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
