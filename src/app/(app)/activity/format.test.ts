import { describe, expect, it } from "vitest";
import { formatShortDay } from "./format";

describe("formatShortDay", () => {
  it("always includes the year", () => {
    expect(formatShortDay("2026-11-03")).toBe("Nov 3, 2026");
    expect(formatShortDay("2027-01-01")).toBe("Jan 1, 2027");
  });
});
