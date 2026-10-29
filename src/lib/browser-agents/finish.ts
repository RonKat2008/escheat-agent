import type { FencedBrowser } from "./browser";
import type { PortalDriver } from "./driver";
import type { RunRecorder } from "./recorder";

export async function finishBrowser(rec: RunRecorder, browser: FencedBrowser | undefined, driver: PortalDriver | undefined, status: "succeeded" | "failed", error?: string) {
  await driver?.close();
  const videoPromise = browser?.videoPath();
  await browser?.close();
  const video = await videoPromise;
  if (video) rec.setOutput({ video });
  if (browser && browser.blocked.length > 0) rec.setOutput({ blockedRequests: browser.blocked });
  await rec.finish(status, error);
}
