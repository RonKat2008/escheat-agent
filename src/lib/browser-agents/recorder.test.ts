import { describe, expect, it } from "vitest";
import { usageCostMicros } from "./recorder";

describe("usageCostMicros", () => {
  it("is exactly zero for scripted runs (no model called)", () => {
    expect(usageCostMicros({ model: null, inputTokens: 0, outputTokens: 0 })).toBe(0);
  });
  it("prices live Stagehand usage, stripping the provider prefix", () => {
    // sonnet-5-5: $2/M in, $10/M out => 1000*2 + 500*10 micros
    expect(usageCostMicros({ model: "anthropic/claude-sonnet-5-5", inputTokens: 1000, outputTokens: 500 })).toBe(7000);
  });
  it("is null (never a guess) for an unpriced model", () => {
    expect(usageCostMicros({ model: "mystery-model", inputTokens: 10, outputTokens: 10 })).toBeNull();
  });
});
