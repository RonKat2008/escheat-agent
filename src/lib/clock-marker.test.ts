import { describe, expect, it } from "vitest";
import { isAfterDemoClock } from "./clock-marker";

describe("isAfterDemoClock", () => {
  it("marks days later than the demo date only", () => {
    expect(isAfterDemoClock("2026-12-16", "2026-11-01")).toBe(true);
    expect(isAfterDemoClock("2026-11-01", "2026-11-01")).toBe(false);
    expect(isAfterDemoClock("2026-10-31", "2026-11-01")).toBe(false);
  });
  it("ignores missing or malformed days", () => {
    expect(isAfterDemoClock(null, "2026-11-01")).toBe(false);
    expect(isAfterDemoClock("unknown", "2026-11-01")).toBe(false);
  });
});
