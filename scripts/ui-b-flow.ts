import { chromium } from "playwright";
const out = "/Users/ronitkatikaneni/escheat-agent-research/screens/ui-b";
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  await p.goto("http://localhost:3202/approvals", { waitUntil: "networkidle" });
  await p.locator("[data-key^='o:']").first().click();
  await p.waitForTimeout(500);
  await p.screenshot({ path: `${out}/flow-1-selected.png`, fullPage: true });
  const compose = p.getByTestId("compose-btn");
  if (await compose.isVisible().catch(() => false)) { await compose.click(); await p.waitForTimeout(2500); }
  await p.screenshot({ path: `${out}/flow-2-composed.png`, fullPage: true });
  const rc = p.getByTestId("recompose-btn");
  if (await rc.isVisible().catch(() => false)) { await rc.click(); await p.waitForTimeout(2500); }
  const ap = p.getByTestId("approve-btn");
  console.log("approve enabled:", await ap.isEnabled());
  if (await ap.isEnabled()) { await ap.click(); await p.waitForTimeout(2500); }
  await p.screenshot({ path: `${out}/flow-3-approved.png`, fullPage: true });
  const send = p.getByTestId("send-btn");
  console.log("send enabled:", await send.isEnabled());
  if (await send.isEnabled()) { await send.click(); await p.waitForTimeout(3500); }
  await p.screenshot({ path: `${out}/flow-4-sent.png`, fullPage: true });
  await b.close();
})();
