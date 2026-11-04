import { describe, expect, it } from "vitest";
import type { FencedBrowser } from "./browser";
import type { PortalDriver } from "./driver";
import type { RunRecorder } from "./recorder";
import { finishBrowser } from "./finish";

// R4-23: the run row must be settled before the slow browser/video teardown, or /runs shows "Running" for ~30 s
// after the confirmation number is already on screen.
describe("finishBrowser", () => {
  it("marks the run finished before closing the driver and the browser", async () => {
    const order: string[] = [];
    const rec = {
      finish: async (status: string) => void order.push(`finish:${status}`),
      setOutput: () => void order.push("setOutput"),
      flush: async () => void order.push("flush"),
    } as unknown as RunRecorder;
    const driver = { mode: "scripted", usage: async () => undefined, close: async () => void order.push("driver.close") } as unknown as PortalDriver;
    const browser = {
      blocked: [],
      videoPath: async () => "video.webm",
      close: async () => {
        await new Promise((r) => setTimeout(r, 20));
        order.push("browser.close");
      },
    } as unknown as FencedBrowser;

    await finishBrowser(rec, browser, driver, "succeeded");

    expect(order[0]).toBe("finish:succeeded");
    expect(order.indexOf("finish:succeeded")).toBeLessThan(order.indexOf("driver.close"));
    expect(order.indexOf("finish:succeeded")).toBeLessThan(order.indexOf("browser.close"));
    // The video path still lands in the output, after the close.
    expect(order.indexOf("setOutput")).toBeGreaterThan(order.indexOf("browser.close"));
    expect(order.at(-1)).toBe("flush");
  });

  it("frees the run's slot as soon as the row settles, so a new run is not refused during the teardown", async () => {
    const order: string[] = [];
    const rec = {
      finish: async (status: string) => void order.push(`finish:${status}`),
      setOutput: () => undefined,
      flush: async () => undefined,
    } as unknown as RunRecorder;
    const browser = { blocked: [], videoPath: async () => undefined, close: async () => void order.push("browser.close") } as unknown as FencedBrowser;

    await finishBrowser(rec, browser, undefined, "succeeded", undefined, () => order.push("released"));

    expect(order).toEqual(["finish:succeeded", "released", "browser.close"]);
  });
});
