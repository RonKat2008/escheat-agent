import { describe, expect, it } from "vitest";
import { progressToToday } from "./progress";

describe("progressToToday", () => {
  const dates = ["2025-09-01", "2028-09-01", "2028-10-31", "2029-05-01", "2029-10-31", "2030-06-17"];

  it("interpolates by days between the two nodes around today", () => {
    // 2027-03-03 is exactly halfway (in days) between 2025-09-01 and 2028-09-01 (1096 days apart).
    expect(progressToToday(dates, "2027-03-03")).toBeCloseTo(0.5 / 5, 5);
  });

  it("lands exactly on a node whose date is today", () => {
    expect(progressToToday(dates, "2028-10-31")).toBeCloseTo(2 / 5, 10);
  });

  it("is 1 after the last date and sits on the first dated node before it", () => {
    expect(progressToToday(dates, "2031-01-01")).toBe(1);
    expect(progressToToday(dates, "2020-01-01")).toBe(0);
    expect(progressToToday([null, "2028-01-01", "2029-01-01"], "2020-01-01")).toBe(0.5);
  });

  it("skips undated nodes instead of guessing their dates", () => {
    // Today is halfway (by days) between node 0 and node 2; node 1 is unknown, so the bar stops at node 1's position.
    expect(progressToToday(["2026-01-01", null, "2026-01-21"], "2026-01-11")).toBeCloseTo(0.5, 10);
  });

  it("is 0 with nothing to place it against", () => {
    expect(progressToToday([], "2026-01-01")).toBe(0);
    expect(progressToToday(["2026-01-01"], "2026-06-01")).toBe(0);
    expect(progressToToday([null, null], "2026-06-01")).toBe(0);
  });
});
