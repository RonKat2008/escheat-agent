/**
 * Dogfood round 7 throwaway route sweep. Not part of the test suite.
 * Usage: BASE=http://localhost:3966 PHASE=a EXTRA="/owner/xyz,/runs/abc" pnpm exec tsx scripts/dogfood/sweep7.ts
 * Writes JSON to $OUT and full-page shots to $SHOTS/<phase>-<route>-<width>.png
 */
import { writeFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { chromium, type Page } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:3966";
const PHASE = process.env.PHASE ?? "a";
const SHOTS = process.env.SHOTS ?? "/Users/ronitkatikaneni/escheat-agent/.data/shots/dogfood7";
const OUT = process.env.OUT ?? `/private/tmp/sweep7-${PHASE}.json`;
const DISCLAIMER = "Prototype. Not legal advice. Confirm filings with a qualified professional.";
const ROUTES = [
  "/", "/how-it-works", "/security", "/login", "/dashboard", "/items", "/payees", "/approvals", "/chat",
  "/close-out/CA", "/close-out/DE", "/close-out/TX", "/eval", "/forecast", "/reports", "/recoveries", "/rules",
  "/runs", "/settings/integrations", "/activity", "/owner/link-error",
  "/replica/tx-holder", "/replica/tx-holder/dashboard", "/replica/ca-holder/dashboard", "/replica/de-holder/dashboard",
  "/replica/tx-search", "/replica/tx-search/claims",
  ...(process.env.EXTRA ? process.env.EXTRA.split(",") : []),
];
const WIDTHS = (process.env.WIDTHS ?? "1440,1024,375").split(",").map(Number);

async function offPalette(page: Page) {
  return page.evaluate(() => {
    const toLin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    function rgbToOklch(r: number, g: number, b: number) {
      const [R, G, B] = [r / 255, g / 255, b / 255].map(toLin);
      const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
      const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
      const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
      const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
      const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
      const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
      const C = Math.hypot(a, bb);
      let H = (Math.atan2(bb, a) * 180) / Math.PI;
      if (H < 0) H += 360;
      return { L, C, H };
    }
    function parse(v: string): { L: number; C: number; H: number; A: number } | null {
      if (!v || v === "none" || v === "transparent") return null;
      let m = v.match(/^oklch\(([\d.]+)%?\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?/);
      if (m) {
        let L = +m[1];
        if (L > 1) L /= 100;
        return { L, C: +m[2], H: +m[3], A: m[4] ? +m[4] : 1 };
      }
      m = v.match(/^rgba?\(([\d.]+),?\s*([\d.]+),?\s*([\d.]+)(?:,?\s*\/?\s*([\d.]+))?/);
      if (m) return { ...rgbToOklch(+m[1], +m[2], +m[3]), A: m[4] !== undefined ? +m[4] : 1 };
      return null;
    }
    const inBand = (H: number) => (H >= 240 && H <= 290) || H >= 325 || H <= 15;
    const hits = new Map<string, string>();
    for (const el of Array.from(document.querySelectorAll("body *"))) {
      const r = (el as HTMLElement).getBoundingClientRect?.();
      if (!r || r.width === 0 || r.height === 0) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none" || +cs.opacity === 0) continue;
      const props: [string, string][] = [
        ["color", cs.color],
        ["bg", cs.backgroundColor],
        ["border", cs.borderTopWidth !== "0px" ? cs.borderTopColor : ""],
        ["fill", el instanceof SVGElement ? cs.fill : ""],
        ["stroke", el instanceof SVGElement ? cs.stroke : ""],
      ];
      for (const [k, v] of props) {
        const p = parse(v);
        if (!p || p.A < 0.15 || p.C <= 0.045 || inBand(p.H)) continue;
        const key = `${k}:${v}`;
        const cls = (el as unknown as { className?: { baseVal?: string } | string }).className;
        const clsText = typeof cls === "string" ? cls : (cls?.baseVal ?? "");
        if (!hits.has(key)) hits.set(key, `${el.tagName.toLowerCase()}.${clsText.slice(0, 60)} "${(el.textContent ?? "").trim().slice(0, 40)}" H=${p.H.toFixed(0)} C=${p.C.toFixed(3)}`);
      }
    }
    return [...hits.entries()].slice(0, 12).map(([k, v]) => `${k} @ ${v}`);
  });
}

async function settle(page: Page) {
  await page.evaluate(() =>
    Promise.race([
      Promise.all(document.getAnimations().filter((a) => a.playState === "running" && a.effect?.getComputedTiming().iterations !== Infinity).map((a) => a.finished.catch(() => 0))),
      new Promise((r) => setTimeout(r, 5000)),
    ]),
  );
}

(async () => {
  const browser = await chromium.launch();
  const results: unknown[] = [];
  for (const width of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, ...(width === 375 ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
    await ctx.addInitScript("window.__name = (f) => f");
    for (const route of ROUTES) {
      const page = await ctx.newPage();
      const errors: string[] = [];
      page.on("console", (m) => {
        if (m.type() === "error") errors.push(m.text().slice(0, 200));
      });
      page.on("pageerror", (e) => errors.push("pageerror: " + e.message.slice(0, 200)));
      page.on("response", (r) => {
        if (r.status() >= 500) errors.push(`HTTP ${r.status()} ${r.url()}`);
      });
      const t0 = Date.now();
      let status = 0;
      try {
        const res = await page.goto(BASE + route, { waitUntil: "load", timeout: 60_000 });
        status = res?.status() ?? 0;
        await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => 0);
        await settle(page);
      } catch (e) {
        errors.push("nav: " + String(e).slice(0, 150));
      }
      const ms = Date.now() - t0;
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth).catch(() => -1);
      const text = await page.evaluate(() => document.body.innerText).catch(() => "");
      const disclaimer = text.includes(DISCLAIMER);
      const unverified = (text.match(/UNVERIFIED/g) ?? []).length;
      let axe: string[] = [];
      try {
        if (process.env.PALONLY) throw new Error("skip");
        const { violations } = await new AxeBuilder({ page }).setLegacyMode(true).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
        axe = violations
          .filter((v) => v.impact === "serious" || v.impact === "critical")
          .map((v) => `${v.id}(${v.nodes.length}): ${v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" | ")}`);
      } catch (e) {
        axe = ["axe-failed " + String(e).slice(0, 100)];
      }
      const palette = await offPalette(page).catch((e) => ["palette-failed " + String(e).slice(0, 80)]);
      const slug = route.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "home";
      if (!process.env.PALONLY) await page.screenshot({ path: `${SHOTS}/${PHASE}-${slug}-${width}.png`, fullPage: true }).catch(() => 0);
      results.push({ route, width, status, ms, overflow, disclaimer, unverified, errors, axe, palette });
      const bad = errors.length || overflow > 0 || axe.length || !disclaimer || (palette.length && !route.startsWith("/replica"));
      console.log(`${bad ? "!!" : "ok"} ${width} ${route} ${status} ${ms}ms ovf=${overflow} disc=${disclaimer} unv=${unverified} err=${errors.length} axe=${axe.length} pal=${palette.length}`);
      await page.close();
    }
    await ctx.close();
  }
  await browser.close();
  writeFileSync(OUT, JSON.stringify(results, null, 2));
})();
