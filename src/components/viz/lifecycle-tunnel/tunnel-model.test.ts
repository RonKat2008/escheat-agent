import { describe, expect, it } from "vitest";
import { clampFocus, defaultFocus, layoutTunnel, RING_GAP, todayDepth, type TunnelStageInput } from "./tunnel-model";

const stages: TunnelStageInput[] = [
  { key: "issued", label: "Issued", date: "2024-01-01", verified: true, legal: false },
  { key: "stale", label: "Stale", date: "2024-07-01", verified: true, legal: false },
  { key: "presumed_abandoned", label: "Presumed abandoned", date: "2026-01-01", verified: false, legal: true, rulePath: "a.b" },
  { key: "dd_window_start", label: "DD opens", date: "2026-11-05", verified: false, legal: true },
  { key: "dd_window_end", label: "DD closes", date: "2027-01-01", verified: true, legal: true },
  { key: "report_due", label: "Report due", date: null, verified: false, legal: true },
  { key: "remit_due", label: "Remit due", date: "2027-06-01", verified: true, legal: true },
];

describe("layoutTunnel", () => {
  it("places rings 220px apart in depth, in lifecycle order", () => {
    const l = layoutTunnel({ stages, asOf: "2026-11-01", nextKey: "dd_window_start" });
    expect(l.rings.map((r) => r.z)).toEqual(stages.map((_, i) => -i * RING_GAP || 0));
  });

  it("marks past, next (urgent within 7 days), future and unknown rings", () => {
    const l = layoutTunnel({ stages, asOf: "2026-11-01", nextKey: "dd_window_start" });
    const by = Object.fromEntries(l.rings.map((r) => [r.key, r]));
    expect(by.issued!.state).toBe("past");
    expect(by.dd_window_start!.state).toBe("next");
    expect(by.dd_window_start!.urgent).toBe(true);
    expect(by.dd_window_end!.state).toBe("future");
    expect(by.report_due!.state).toBe("unknown");
    expect(by.report_due!.date).toBeNull();
  });

  it("is not urgent when the next ring is more than 7 days out", () => {
    const l = layoutTunnel({ stages, asOf: "2026-10-01", nextKey: "dd_window_start" });
    expect(l.rings[3]!.urgent).toBe(false);
  });

  it("flags only unverified legal dates (never ledger facts or unknown dates)", () => {
    const l = layoutTunnel({ stages, asOf: "2026-11-01" });
    expect(l.rings.filter((r) => r.unverified).map((r) => r.key)).toEqual(["presumed_abandoned", "dd_window_start"]);
  });

  it("parks the camera on the next deadline by default and hides rings behind it", () => {
    const l = layoutTunnel({ stages, asOf: "2026-11-01", nextKey: "dd_window_start" });
    expect(l.focus).toBe(3);
    expect(l.cameraZ).toBe(3 * RING_GAP);
    expect(l.rings[2]!.visible).toBe(false);
    expect(l.rings[2]!.opacity).toBe(0);
    expect(l.rings[3]!.opacity).toBe(1);
    expect(l.rings[6]!.opacity).toBeLessThan(l.rings[4]!.opacity);
  });

  it("clamps an explicit focus into range", () => {
    expect(layoutTunnel({ stages, asOf: "2026-11-01", focus: 99 }).focus).toBe(6);
    expect(layoutTunnel({ stages, asOf: "2026-11-01", focus: -3 }).focus).toBe(0);
    expect(clampFocus(2, 0)).toBe(0);
  });

  it("caps the tunnel at 8 rings", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ key: `k${i}`, label: `L${i}`, date: null, verified: true, legal: false }));
    expect(layoutTunnel({ stages: many, asOf: "2026-01-01" }).rings).toHaveLength(8);
  });
});

describe("todayDepth", () => {
  it("interpolates between the surrounding dated rings by days, skipping unknown ones", () => {
    // 2026-11-05 (index 3) and 2027-01-01 (index 4): asOf 2026-12-03 is halfway (28 of 57 days)
    const d = todayDepth(stages, "2026-12-03")!;
    expect(d).toBeGreaterThan(3.4);
    expect(d).toBeLessThan(3.6);
    // between index 4 and index 6 (index 5 is unknown)
    const e = todayDepth(stages, "2027-03-15")!;
    expect(e).toBeGreaterThan(4);
    expect(e).toBeLessThan(6);
  });

  it("sits before the first ring or after the last one at the ends, and is null with no dates", () => {
    expect(todayDepth(stages, "2020-01-01")).toBe(0);
    expect(todayDepth(stages, "2030-01-01")).toBe(6.5);
    expect(todayDepth([{ date: null }], "2026-01-01")).toBeNull();
  });
});

describe("defaultFocus", () => {
  it("falls back to the last dated ring when there is no next deadline", () => {
    expect(defaultFocus(stages, undefined)).toBe(6);
    expect(defaultFocus([{ key: "x", label: "x", date: null, verified: true, legal: true }], undefined)).toBe(0);
  });
});
