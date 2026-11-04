import { describe, expect, it } from "vitest";
import { demoDayAt, type ClockStep } from "@/lib/clock-history";
import { allMovements, itemMovements, remittanceOf } from "./movements";
import { item } from "./test-items";

const TODAY = "2026-11-01";
const HISTORY: ClockStep[] = [{ atMs: Date.parse("2026-11-04T09:00:00Z"), day: "2026-11-01" }];

describe("itemMovements: dating", () => {
  it("an open item has only its identified movement, on stale_since", () => {
    const ms = itemMovements(item({ staleSince: "2025-07-30", status: "to_report" }), HISTORY, TODAY);
    expect(ms).toHaveLength(1);
    expect(ms[0]).toMatchObject({ kind: "identified", date: "2025-07-30", state: "TX", amountCents: 10_000 });
  });

  it("a remitted item is dated by the recorded remittedOn, with its report and reference", () => {
    const it0 = item({
      status: "remitted",
      resolvedAt: "2026-11-01T00:00:00.000Z",
      classification: { remittance: { reportId: "r-1", remittedOn: "2026-10-28", reference: "WIRE-1", by: "A", recordedAt: "x", approvalId: "a" } },
    });
    const [, settle] = itemMovements(it0, HISTORY, TODAY);
    expect(settle).toMatchObject({ kind: "remitted", date: "2026-10-28", reportId: "r-1", reference: "WIRE-1" });
  });

  it("a resolution is dated by the demo day resolve.ts stored (classification.resolution.at)", () => {
    const it0 = item({ status: "resolved_paid", resolvedAt: "2026-09-15T00:00:00.000Z", classification: { resolution: { at: "2026-09-15" } } });
    expect(itemMovements(it0, HISTORY, TODAY)[1]).toMatchObject({ kind: "resolved", date: "2026-09-15" });
  });

  it("a demo-day-at-midnight resolved_at keeps its day after the demo clock jumps (demoDayAt alone would move it)", () => {
    const it0 = item({ status: "resolved_paid", resolvedAt: "2026-12-15T00:00:00.000Z" });
    // The clock was later jumped to 2027-01-10 (a real instant before 2026-12-15 UTC).
    const jumped: ClockStep[] = [...HISTORY, { atMs: Date.parse("2026-11-05T09:00:00Z"), day: "2027-01-10" }];
    expect(demoDayAt("2026-12-15T00:00:00.000Z", jumped, "2027-01-10")).toBe("2027-01-10");
    expect(itemMovements(it0, jumped, "2027-01-10")[1]!.date).toBe("2026-12-15");
    expect(itemMovements(it0, HISTORY, TODAY)[1]!.date).toBe("2026-12-15");
  });

  it("a genuine real-time resolved_at is mapped through the clock history (demoDayAt)", () => {
    const it0 = item({ status: "resolved_paid", resolvedAt: "2026-11-04T10:12:13.000Z" });
    expect(itemMovements(it0, HISTORY, TODAY)[1]!.date).toBe("2026-11-01");
  });

  it("a resolved item with a bank clear on/after it went stale is 'cleared late by bank' on the clear date", () => {
    const it0 = item({ status: "resolved_paid", staleSince: "2026-03-10", lateClearDate: "2026-06-02", classification: { resolution: { at: "2026-07-01" } } });
    expect(itemMovements(it0, HISTORY, TODAY)[1]).toMatchObject({ kind: "cleared_late", date: "2026-06-02" });
  });

  it("never dates a settlement before recognition, and flags an undated one", () => {
    const early = item({ status: "resolved_paid", staleSince: "2026-03-10", classification: { resolution: { at: "2026-01-01" } } });
    expect(itemMovements(early, HISTORY, TODAY)[1]!.date).toBe("2026-03-10");
    const undated = item({ status: "remitted", staleSince: "2026-03-10" });
    expect(itemMovements(undated, HISTORY, TODAY)[1]).toMatchObject({ kind: "remitted", date: "2026-03-10", undated: true });
  });

  it("groups an unknown owner state as UNKNOWN", () => {
    expect(allMovements([item({ state: null })], HISTORY, TODAY)[0]!.state).toBe("UNKNOWN");
  });

  it("remittanceOf ignores a malformed record", () => {
    expect(remittanceOf({ remittance: { reportId: "r", remittedOn: "soon" } })).toBeNull();
    expect(remittanceOf(null)).toBeNull();
  });
});
