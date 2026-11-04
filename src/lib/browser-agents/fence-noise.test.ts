import { describe, expect, it } from "vitest";
import { cleanFenceMessages, describeFenceEvent, isDevAssetUrl, isDevFenceNoise } from "./fence-noise";

describe("isDevFenceNoise", () => {
  it.each([
    "[replica-fence] closed websocket ws://localhost:3490/_next/hmr?id=N5NcRLb6v9z9bBveKDKaN",
    "[replica-fence] blocked http://localhost:3490/__nextjs_font/geist-latin.woff2",
    "[replica-fence] blocked http://127.0.0.1:3000/_next/static/chunks/main.js",
  ])("drops dev-server asset blocks: %s", (m) => expect(isDevFenceNoise(m)).toBe(true));

  it.each([
    "[replica-fence] blocked https://www.sco.ca.gov/",
    "[replica-fence] closed websocket wss://evil.example.com/_next/hmr",
    "[replica-fence] blocked http://localhost:3490/api/clock",
    "[replica-fence] navigation violation http://localhost:3490/_next/static/x.js",
    "Signed in to the CA replica holder portal",
  ])("keeps real fence events and other steps: %s", (m) => expect(isDevFenceNoise(m)).toBe(false));
});

describe("isDevAssetUrl", () => {
  it("only matches local-origin dev assets", () => {
    expect(isDevAssetUrl("http://localhost:3000/_next/static/a.js")).toBe(true);
    expect(isDevAssetUrl("https://cdn.example.com/_next/static/a.js")).toBe(false);
    expect(isDevAssetUrl("not a url")).toBe(false);
  });
});

describe("describeFenceEvent", () => {
  it("words real blocks plainly without the raw prefix", () => {
    const out = describeFenceEvent("[replica-fence] blocked https://www.sco.ca.gov/");
    expect(out).toContain("outside the replica sandbox");
    expect(out).not.toContain("[replica-fence]");
  });
  it("words websockets and navigation violations", () => {
    expect(describeFenceEvent("[replica-fence] closed websocket wss://x.example.com/s")).toContain("live connection to x.example.com");
    expect(describeFenceEvent("[replica-fence] navigation violation https://x.example.com/")).toContain("Stopped navigation");
  });
  it("leaves other text alone", () => {
    expect(describeFenceEvent("hello")).toBe("hello");
  });
});

describe("cleanFenceMessages", () => {
  it("filters noise, rewords real blocks, keeps other steps", () => {
    const steps = [
      { message: "[replica-fence] closed websocket ws://localhost:3490/_next/hmr?id=1", kind: "guard_blocked" },
      { message: "[replica-fence] blocked https://www.sco.ca.gov/", kind: "guard_blocked" },
      { message: "Searching CA", kind: "action" },
    ];
    const out = cleanFenceMessages(steps);
    expect(out.map((s) => s.kind)).toEqual(["guard_blocked", "action"]);
    expect(out[0]!.message).toContain("outside the replica sandbox");
  });
});

describe("prefetchBlockPath (R8-20)", () => {
  it("recognises a blocked local _rsc prefetch, raw or reworded", async () => {
    const { prefetchBlockPath } = await import("./fence-noise");
    expect(prefetchBlockPath("[replica-fence] blocked http://localhost:3970/dashboard?_rsc=abc")).toBe("/dashboard");
    expect(prefetchBlockPath("Blocked a request to localhost:3970 (outside the replica sandbox): http://localhost:3970/runs?_rsc=x")).toBe("/runs");
  });
  it("never treats real blocks as prefetches", async () => {
    const { prefetchBlockPath } = await import("./fence-noise");
    expect(prefetchBlockPath("[replica-fence] blocked http://localhost:3970/dashboard")).toBeNull();
    expect(prefetchBlockPath("[replica-fence] blocked https://evil.example.com/x?_rsc=1")).toBeNull();
    expect(prefetchBlockPath("[replica-fence] navigation violation http://localhost:3970/dashboard?_rsc=1")).toBeNull();
  });
});
