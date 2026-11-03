import { describe, expect, it } from "vitest";
import { layoutLifecycle, type LifecycleInput } from "./lifecycle-model";

const ev = (key: string, date: string | null, over: Partial<LifecycleInput["events"][number]> = {}) => ({
  key,
  label: key,
  date,
  status: (date ? "ok" : "unknown") as "ok" | "unknown",
  verified: true,
  ...over,
});

const base: LifecycleInput = {
  issueDate: "2023-01-01",
  staleSince: "2023-07-01",
  asOf: "2024-01-01",
  events: [
    ev("remit_due", "2026-06-30"),
    ev("presumed_abandoned", "2026-01-01"),
    ev("report_due", "2026-05-01"),
  ],
};

describe("layoutLifecycle", () => {
  const out = layoutLifecycle(base, 800);
  const dated = out.nodes.filter((n) => n.state !== "unknown");

  it("orders dated nodes by date and increasing x", () => {
    expect(dated.map((n) => n.key)).toEqual(["issued", "stale", "presumed_abandoned", "report_due", "remit_due"]);
    for (let i = 1; i < dated.length; i++) expect(dated[i]!.x).toBeGreaterThanOrEqual(dated[i - 1]!.x);
  });

  it("places today between past and next and ends progress there", () => {
    const stale = dated.find((n) => n.key === "stale")!;
    const next = dated.find((n) => n.state === "next")!;
    expect(next.key).toBe("presumed_abandoned");
    expect(out.todayX).toBeGreaterThan(stale.x);
    expect(out.todayX).toBeLessThan(next.x);
    expect(out.progressEnd).toBe(out.todayX);
    expect(dated.filter((n) => n.state === "past").map((n) => n.key)).toEqual(["issued", "stale"]);
  });

  it("flags urgency only within 7 days", () => {
    const at = (asOf: string) => layoutLifecycle({ ...base, asOf }, 800).nodes.find((n) => n.state === "next")!;
    expect(at("2025-12-25").urgent).toBe(true); // exactly 7 days
    expect(at("2025-12-24").urgent).toBe(false); // 8 days
    expect(at("2025-12-31").urgent).toBe(true);
    expect(at("2024-01-01").urgent).toBe(false);
  });

  it("puts unknown and not-applicable dates in the Unknown lane, never estimated", () => {
    const o = layoutLifecycle(
      { ...base, events: [...base.events, ev("dd_window_start", null), ev("dd_window_end", null, { status: "not_applicable" })] },
      800,
    );
    const unk = o.nodes.filter((n) => n.state === "unknown");
    expect(unk.map((n) => n.key)).toEqual(["dd_window_start", "dd_window_end"]);
    expect(unk.every((n) => n.date === null && !n.urgent)).toBe(true);
    expect(unk[1]!.reason).toBe("not_applicable");
    expect(o.unknownLane).not.toBeNull();
    for (const n of unk) {
      expect(n.x).toBeGreaterThanOrEqual(o.unknownLane!.x0);
      expect(n.x).toBeLessThanOrEqual(o.unknownLane!.x1);
    }
    expect(o.trackEnd).toBeLessThan(o.unknownLane!.x0);
  });

  it("marks unverified events but not issued/stale", () => {
    const o = layoutLifecycle({ ...base, events: [ev("report_due", "2026-05-01", { verified: false })] }, 800);
    expect(o.nodes.find((n) => n.key === "report_due")!.unverified).toBe(true);
    expect(o.nodes.find((n) => n.key === "issued")!.unverified).toBe(false);
  });

  it("has no unknown lane when everything is dated, and staggers crowded labels", () => {
    const o = layoutLifecycle(
      { issueDate: "2024-01-01", asOf: "2024-01-02", events: [ev("a", "2024-01-03"), ev("b", "2024-01-04"), ev("c", "2025-01-01")] },
      600,
    );
    expect(o.unknownLane).toBeNull();
    expect(new Set(o.nodes.map((n) => n.row)).size).toBeGreaterThan(1);
  });
});
