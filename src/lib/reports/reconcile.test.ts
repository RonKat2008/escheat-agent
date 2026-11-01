import { describe, expect, it } from "vitest";
import { isReportLocked, reconcileReport } from "./reconcile";

const base = { pool: { count: 0, cents: 0 }, report: { count: 2, cents: 5000 }, file: { count: 2, cents: 5000 } };

describe("reconcileReport", () => {
  it("an open report is compared with the live pool and flags drift", () => {
    const r = reconcileReport({ ...base, status: "validated", pool: { count: 3, cents: 9000 } });
    expect(r.locked).toBe(false);
    expect(r.rows.map((x) => x.label)).toContain("Items to report now");
    expect(r.matches).toBe(false);
  });

  it("a submitted report ignores the (now empty) pool and compares against its own snapshot", () => {
    for (const status of ["submitted", "confirmed"]) {
      const r = reconcileReport({ ...base, status });
      expect(r.locked).toBe(true);
      expect(r.rows.map((x) => x.label)).not.toContain("Items to report now");
      expect(r.matches).toBe(true);
    }
  });

  it("a locked report whose file disagrees with its row still reports a mismatch", () => {
    expect(reconcileReport({ ...base, status: "confirmed", file: { count: 2, cents: 4000 } }).matches).toBe(false);
  });

  it("knows which statuses lock", () => {
    expect(["submitted", "confirmed"].every(isReportLocked)).toBe(true);
    expect(["draft", "validated", "awaiting_approval", "approved", "failed"].some(isReportLocked)).toBe(false);
  });
});
