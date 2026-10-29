/** Screenshots of the UI-B pages at 375/1024/1440. Usage: tsx scripts/ui-b-shots.ts <baseUrl> <outDir> [paths...] */
import { chromium } from "playwright";

const base = process.argv[2] ?? "http://localhost:3202";
const out = process.argv[3] ?? "/Users/ronitkatikaneni/escheat-agent-research/screens/ui-b";
const paths = process.argv.slice(4).length ? process.argv.slice(4) : ["/approvals", "/reports", "/recoveries", "/runs", "/eval"];
const sizes = [
  { w: 375, h: 812 },
  { w: 1024, h: 768 },
  { w: 1440, h: 900 },
];

async function main() {
  const browser = await chromium.launch();
  for (const p of paths) {
    for (const s of sizes) {
      const ctx = await browser.newContext({ viewport: { width: s.w, height: s.h } });
      const page = await ctx.newPage();
      await page.goto(base + p, { waitUntil: "networkidle" }).catch(() => undefined);
      await page.waitForTimeout(700);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      const name = p.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "root";
      await page.screenshot({ path: `${out}/${name}-${s.w}.png`, fullPage: true });
      console.log(`${p} @${s.w}: horizontal overflow ${overflow}px`);
      await ctx.close();
    }
  }
  await browser.close();
}
main();
