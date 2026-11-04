import { describe, expect, it } from "vitest";
import { auditSeed, drawSample } from "./sample";

const IDS = Array.from({ length: 30 }, (_, i) => `id-${String(i).padStart(2, "0")}`);

describe("audit sample", () => {
  it("the seed is sha256 of state + demo date + size", () => {
    const s = auditSeed("de", "2026-11-01", 5);
    expect(s).toMatch(/^[0-9a-f]{64}$/);
    expect(s).toBe(auditSeed("DE", "2026-11-01", 5));
    expect(s).not.toBe(auditSeed("DE", "2026-11-02", 5));
    expect(s).not.toBe(auditSeed("DE", "2026-11-01", 10));
    expect(s).not.toBe(auditSeed("CA", "2026-11-01", 5));
  });

  it("same seed draws the same sample, whatever the row order", () => {
    const seed = auditSeed("DE", "2026-11-01", 5);
    const a = drawSample(IDS, seed, 5);
    const b = drawSample([...IDS].reverse(), seed, 5);
    expect(a).toEqual(b);
    expect(a).toHaveLength(5);
    expect(new Set(a).size).toBe(5);
  });

  it("a different seed draws a different sample", () => {
    expect(drawSample(IDS, auditSeed("DE", "2026-11-01", 5), 5)).not.toEqual(drawSample(IDS, auditSeed("DE", "2026-11-02", 5), 5));
  });

  it("the sample size is capped at the population", () => {
    expect(drawSample(IDS.slice(0, 3), auditSeed("TX", "2026-11-01", 25), 25)).toHaveLength(3);
    expect(drawSample([], auditSeed("TX", "2026-11-01", 5), 5)).toEqual([]);
  });

  it("all returns every item, sorted", () => {
    expect(drawSample([...IDS].reverse(), "00", 5, true)).toEqual(IDS);
  });
});
