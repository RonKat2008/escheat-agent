import type { FencedBrowser } from "./browser";
import { isDevAssetUrl } from "./fence-noise";
import type { PortalDriver } from "./driver";
import type { RunRecorder } from "./recorder";

export async function finishBrowser(rec: RunRecorder, browser: FencedBrowser | undefined, driver: PortalDriver | undefined, status: "succeeded" | "failed", error?: string) {
  const usage = (await driver?.usage?.().catch(() => undefined)) ?? undefined; // read before close(): metrics die with the session
  await driver?.close();
  const videoPromise = browser?.videoPath();
  await browser?.close();
  const video = await videoPromise;
  if (video) rec.setOutput({ video });
  if (browser) {
    const real = browser.blocked.filter((u) => !isDevAssetUrl(u));
    if (real.length > 0) rec.setOutput({ blockedRequests: real });
  }
  // Scripted drivers made no model call: record exact zeros. A live driver whose metrics could not be read leaves the columns null.
  await rec.finish(status, error, usage ?? (driver && driver.mode === "scripted" ? { model: null, inputTokens: 0, outputTokens: 0 } : undefined));
}
