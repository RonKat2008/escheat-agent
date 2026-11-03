import { describe, expect, it } from "vitest";
import { layoutCluster, MAX_SPOKES } from "./cluster-model";

const base = {
  canonicalName: "Bayline Electric LLC",
  aliases: ["BAYLINE ELEC", "Bayline Electric"],
  rawNames: [
    { name: "Bayline Electric LLC", lines: 4 },
    { name: "BAYLINE ELEC", lines: 2 },
  ],
  mergeBasis: "model" as const,
  humanReviewed: false,
};

describe("layoutCluster", () => {
  it("puts the canonical name in the middle and one spoke per distinct variant (case-insensitive)", () => {
    const l = layoutCluster(base);
    expect(l.center).toEqual({ name: "Bayline Electric LLC", lines: 4 });
    expect(l.spokes.map((s) => [s.name, s.lines])).toEqual([
      ["BAYLINE ELEC", 2],
      ["Bayline Electric", 0],
    ]);
  });

  it("draws model merges as pending until a person reviews them", () => {
    expect(layoutCluster(base).spokes.every((s) => s.pending && s.basis === "model")).toBe(true);
    const reviewed = layoutCluster({ ...base, humanReviewed: true });
    expect(reviewed.spokes.every((s) => !s.pending && s.basis === "human")).toBe(true);
    expect(layoutCluster({ ...base, mergeBasis: "rule" }).spokes[0]!.pending).toBe(false);
  });

  it("starts at 12 o'clock, stays inside the box and anchors labels away from the centre", () => {
    const l = layoutCluster({ ...base, aliases: ["A", "B", "C", "D"], rawNames: [] });
    expect(l.spokes[0]).toMatchObject({ x: 240, anchor: "middle" });
    expect(l.spokes[0]!.y).toBeLessThan(110);
    expect(l.spokes[1]!.anchor).toBe("start");
    expect(l.spokes[3]!.anchor).toBe("end");
    for (const s of l.spokes) {
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.x).toBeLessThanOrEqual(l.width);
    }
  });

  it("caps the spokes and reports how many are hidden; no variants means no spokes", () => {
    const many = Array.from({ length: MAX_SPOKES + 3 }, (_, i) => `Alias ${i}`);
    const l = layoutCluster({ ...base, aliases: many, rawNames: [] });
    expect(l.spokes).toHaveLength(MAX_SPOKES);
    expect(l.hidden).toBe(3);
    expect(layoutCluster({ ...base, aliases: [], rawNames: [] }).spokes).toEqual([]);
  });
});
