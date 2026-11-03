import { describe, expect, it } from "vitest";
import { computeRenderTier, minTier, type TierSignals } from "./render-tier";

const base: TierSignals = {
  reducedMotion: false,
  saveData: false,
  userReduce: false,
  hardwareConcurrency: 8,
  deviceMemory: 8,
  webgl2: true,
  fpsBelow50: false,
};

describe("computeRenderTier", () => {
  it("is full on a capable device", () => {
    expect(computeRenderTier(base)).toBe("full");
  });
  it("is static for reduced motion, saveData or the user toggle", () => {
    expect(computeRenderTier({ ...base, reducedMotion: true })).toBe("static");
    expect(computeRenderTier({ ...base, saveData: true })).toBe("static");
    expect(computeRenderTier({ ...base, userReduce: true })).toBe("static");
  });
  it("static wins over lite signals", () => {
    expect(computeRenderTier({ ...base, reducedMotion: true, hardwareConcurrency: 2, webgl2: false })).toBe("static");
  });
  it("is lite for low cores, low memory, no webgl2 or low fps", () => {
    expect(computeRenderTier({ ...base, hardwareConcurrency: 4 })).toBe("lite");
    expect(computeRenderTier({ ...base, deviceMemory: 4 })).toBe("lite");
    expect(computeRenderTier({ ...base, webgl2: false })).toBe("lite");
    expect(computeRenderTier({ ...base, fpsBelow50: true })).toBe("lite");
  });
  it("treats unknown hardware signals as capable", () => {
    expect(computeRenderTier({ ...base, hardwareConcurrency: undefined, deviceMemory: null })).toBe("full");
  });
  it("5 cores and 8 GB stay full", () => {
    expect(computeRenderTier({ ...base, hardwareConcurrency: 5, deviceMemory: 8 })).toBe("full");
  });
});

describe("minTier", () => {
  it("never upgrades", () => {
    expect(minTier("lite", "full")).toBe("lite");
    expect(minTier("full", "static")).toBe("static");
    expect(minTier("full", "full")).toBe("full");
  });
});
