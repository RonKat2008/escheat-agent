import { describe, expect, it } from "vitest";
import { compactUSD, roundedWholeUSD } from "./money-label";

describe("money labels round, never truncate (R5-19)", () => {
  it("rounds to the nearest dollar", () => {
    expect(roundedWholeUSD(77374)).toBe("$774");
    expect(roundedWholeUSD(157410)).toBe("$1,574");
    expect(roundedWholeUSD(2335180)).toBe("$23,352");
    expect(roundedWholeUSD(50)).toBe("$1");
    expect(roundedWholeUSD(49)).toBe("$0");
    expect(roundedWholeUSD(0)).toBe("$0");
  });

  it("compacts from $10k up with one decimal", () => {
    expect(compactUSD(77374)).toBe("$774");
    expect(compactUSD(999_949)).toBe("$9,999");
    expect(compactUSD(2_335_180)).toBe("$23.4k");
    expect(compactUSD(1_230_000)).toBe("$12.3k");
    expect(compactUSD(2_000_000)).toBe("$20k");
    expect(compactUSD(2_683_500)).toBe("$26.8k");
    expect(compactUSD(99_995_000)).toBe("$1M");
    expect(compactUSD(125_000_000)).toBe("$1.25M");
  });
});
