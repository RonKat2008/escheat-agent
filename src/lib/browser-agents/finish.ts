import type { FencedBrowser } from "./browser";
import { isDevAssetUrl } from "./fence-noise";
import type { PortalDriver } from "./driver";
import type { RunRecorder } from "./recorder";

/**
 * Settle the run row FIRST, then tear the browser down (R4-23). Closing the driver and the recorded browser context
 * (video finalisation) can take tens of seconds; the confirmation is already recorded by then, so the run must not
 * keep showing "Running" while it happens. The video path and any blocked requests are written to the output after.
 */
export async function finishBrowser(rec: RunRecorder, browser: FencedBrowser | undefined, driver: PortalDriver | undefined, status: "succeeded" | "failed", error?: string) {
  const usage = (await driver?.usage?.().catch(() => undefined)) ?? undefined; // read before close(): metrics die with the session
  // Scripted drivers made no model call: record exact zeros. A live driver whose metrics could not be read leaves the columns null.
  await rec.finish(status, error, usage ?? (driver && driver.mode === "scripted" ? { model: null, inputTokens: 0, outputTokens: 0 } : undefined));
  await driver?.close();
  const videoPromise = browser?.videoPath();
  await browser?.close();
  const video = await videoPromise;
  if (video) rec.setOutput({ video });
  if (browser) {
    const real = browser.blocked.filter((u) => !isDevAssetUrl(u));
    if (real.length > 0) rec.setOutput({ blockedRequests: real });
  }
  if (video || browser) await rec.flush();
}
