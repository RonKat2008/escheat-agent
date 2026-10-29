import { chromium } from "playwright";
const base = process.env.BASE ?? "http://localhost:3201";
const out = "/Users/ronitkatikaneni/escheat-agent-research/screens/ui-a";
const sizes = [[375, 812], [1024, 768], [1440, 900]];
const browser = await chromium.launch();
async function idOf(page, check) {
  await page.goto(`${base}/items?q=${check}`, { waitUntil: "networkidle" });
  const id = await page.locator("tr[data-row-id]").first().getAttribute("data-row-id");
  return id;
}
const ctx0 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const p0 = await ctx0.newPage();
const id = await idOf(p0, "10482");
await ctx0.close();
const pages = process.argv[2] ? process.argv[2].split(",") : ["dashboard", "items", "item-drawer", "rules"];
const urls = { dashboard: "/dashboard", items: "/items", "item-drawer": `/items?item=${id}`, rules: "/rules", "rules-tx": "/rules?state=TX" };
for (const [w, h] of sizes) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  for (const name of pages) {
    await page.goto(base + urls[name], { waitUntil: "networkidle" });
    await page.waitForTimeout(1200);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (overflow > 0) console.log(`OVERFLOW ${name}@${w}: ${overflow}px`);
    await page.screenshot({ path: `${out}/${name}-${w}.png`, fullPage: name !== "item-drawer" });
  }
  await ctx.close();
}
await browser.close();
console.log("done", id);
