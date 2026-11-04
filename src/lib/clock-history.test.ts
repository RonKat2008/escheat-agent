import { describe, expect, it } from "vitest";
import { demoDayAt, type ClockStep } from "./clock-history";

const T = (iso: string) => Date.parse(iso);
// Seed on real Nov 4, 2026 at demo Nov 1, 2026; a jump to Jun 2027, then to Mar 30, 2029.
const HISTORY: ClockStep[] = [
  { atMs: T("2026-11-04T08:00:00Z"), day: "2026-11-01" },
  { atMs: T("2026-11-04T08:10:00Z"), day: "2027-06-15" },
  { atMs: T("2026-11-04T08:20:00Z"), day: "2029-03-30" },
];

describe("demoDayAt (R7-04)", () => {
  it("dates an event by the demo day in force when it happened, across clock jumps", () => {
    expect(demoDayAt("2026-11-04T08:05:00Z", HISTORY, "2029-03-30")).toBe("2026-11-01");
    expect(demoDayAt("2026-11-04T08:15:00Z", HISTORY, "2029-03-30")).toBe("2027-06-15");
    expect(demoDayAt("2026-11-04T08:24:08Z", HISTORY, "2029-03-30")).toBe("2029-03-30");
  });
  it("does not leak the real date once the demo clock is past it", () => {
    expect(demoDayAt("2026-11-04T08:24:08Z", HISTORY, "2029-03-30")).not.toBe("2026-11-04");
  });
  it("keeps the later demo date for events before the clock was moved back", () => {
    const back = [...HISTORY, { atMs: T("2026-11-04T09:00:00Z"), day: "2026-11-01" }];
    expect(demoDayAt("2026-11-04T08:30:00Z", back, "2026-11-01")).toBe("2029-03-30");
    expect(demoDayAt("2026-11-04T09:30:00Z", back, "2026-11-01")).toBe("2026-11-01");
  });
  it("leaves a bare date alone and returns null for no input", () => {
    expect(demoDayAt("2026-10-20", HISTORY, "2029-03-30")).toBe("2026-10-20");
    expect(demoDayAt(null, HISTORY, "2029-03-30")).toBeNull();
  });
  it("falls back to the legacy clamp with no history before the event", () => {
    expect(demoDayAt("2026-11-04T07:00:00Z", HISTORY, "2026-11-01")).toBe("2026-11-01");
    expect(demoDayAt("2026-11-04T07:00:00Z", [], "2026-11-01")).toBe("2026-11-01");
  });
  it("R8-09: puts rows written before the first clock log (the seed) on the first demo day, not the real date, after a jump", () => {
    expect(demoDayAt("2026-11-04T07:59:00Z", HISTORY, "2029-03-30")).toBe("2026-11-01");
    expect(demoDayAt("2026-10-30T07:59:00Z", HISTORY, "2029-03-30")).toBe("2026-10-30");
  });
});
