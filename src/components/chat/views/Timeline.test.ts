import { describe, expect, it } from "vitest";
import type { TimelineEvent } from "@/lib/queries/schemas";
import { nodeStates } from "./Timeline";

const ev = (key: TimelineEvent["key"], date: string | null): TimelineEvent => ({
  key,
  label: key,
  date,
  status: date ? "ok" : "unknown",
  verified: false,
  ruleVersion: "v",
  rulePaths: [],
  sources: [],
  notes: [],
  derivation: [],
  roll: null,
});

describe("nodeStates (F14: 'Next' agrees with the item's next deadline)", () => {
  const events = [
    ev("presumed_abandoned", "2028-09-01"),
    ev("dd_window_start", "2028-10-31"),
    ev("dd_window_end", "2029-04-30"),
    ev("report_due", "2029-10-31"),
    ev("remit_due", null),
  ];
  it("marks the next deadline, not the next event (presumed abandonment is not a deadline)", () => {
    expect(nodeStates(events, "2026-11-01", "dd_window_start")).toEqual(["future", "next", "future", "future", "unknown"]);
  });
  it("marks nothing as next when the item has no upcoming deadline", () => {
    expect(nodeStates(events, "2026-11-01", null)).not.toContain("next");
  });
  it("past dates stay past", () => {
    expect(nodeStates(events, "2029-01-01", "dd_window_end")).toEqual(["past", "past", "next", "future", "unknown"]);
  });
});
