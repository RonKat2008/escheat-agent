import { describe, expect, it } from "vitest";
import { groupDemoDays } from "./demo-days";

describe("groupDemoDays (R7-04)", () => {
  const history = [
    { atMs: Date.parse("2026-11-04T08:00:00Z"), day: "2026-11-01" },
    { atMs: Date.parse("2026-11-04T08:20:00Z"), day: "2029-03-30" },
  ];
  it("lists every demo date a single real day covers, newest first, once each", () => {
    const entries = [{ at: new Date("2026-11-04T08:25:00Z") }, { at: new Date("2026-11-04T08:22:00Z") }, { at: new Date("2026-11-04T08:05:00Z") }];
    expect(groupDemoDays(entries, history, "2029-03-30")).toEqual(["2029-03-30", "2026-11-01"]);
  });
});
