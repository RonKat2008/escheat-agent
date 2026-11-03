import { describe, expect, it } from "vitest";
import { arcPlane, columnHeight, columnName, COLUMN_MAX_PX, COLUMN_MIN_PX, flatArc, layoutColumns, particleCounts } from "./map-model";
import { US_STATES, US_VIEWBOX } from "./us-paths";

describe("columnHeight", () => {
  it("is proportional to cents with a 6px floor and the largest at the max", () => {
    expect(columnHeight(1000, 3, 1000)).toBe(COLUMN_MAX_PX);
    expect(columnHeight(500, 3, 1000)).toBe(COLUMN_MAX_PX / 2);
    expect(columnHeight(1, 1, 1_000_000)).toBe(COLUMN_MIN_PX);
  });
  it("is 0 (a hollow outline) when nothing is owed", () => {
    expect(columnHeight(0, 0, 1000)).toBe(0);
  });
});

describe("layoutColumns", () => {
  it("positions columns at the state centroids as a share of the floor", () => {
    const ca = US_STATES.CA!;
    const [col] = layoutColumns([{ state: "CA", name: ca.name, cents: 100, count: 2, cx: ca.cx, cy: ca.cy }], US_VIEWBOX);
    expect(col!.left).toBeCloseTo(ca.cx / US_VIEWBOX.width);
    expect(col!.top).toBeCloseTo(ca.cy / US_VIEWBOX.height);
    expect(col!.left).toBeLessThan(0.2); // California is on the west edge
    expect(col!.hollow).toBe(false);
  });
});

describe("particles", () => {
  it("scale with item count, at most 12 per arc and 36 overall", () => {
    expect(particleCounts([3, 40])).toEqual([3, 12]);
    expect(particleCounts([12, 12, 12, 12]).reduce((a, n) => a + n, 0)).toBeLessThanOrEqual(36);
  });
});

describe("arcs", () => {
  it("runs from the floor at HQ to the column top", () => {
    const a = arcPlane({ x: 0, y: 0 }, { x: 300, y: 400 }, 80);
    expect(a.length).toBe(500);
    expect(a.angleDeg).toBeCloseTo(53.13, 1);
    expect(a.d.startsWith(`M0,${a.planeHeight}`)).toBe(true);
    expect(a.d.endsWith(`500,${a.planeHeight - 80}`)).toBe(true);
    expect(a.planeHeight).toBeGreaterThan(80);
  });
  it("draws a flat quadratic for the 2D map", () => {
    expect(flatArc({ x: 0, y: 0 }, { x: 100, y: 0 })).toBe("M0,0Q50,-22 100,0");
  });
});

describe("generated geography", () => {
  it("has the 50 states plus DC with paths inside the viewBox", () => {
    expect(Object.keys(US_STATES)).toHaveLength(51);
    for (const code of ["CA", "DE", "TX"]) {
      const s = US_STATES[code]!;
      expect(s.d.startsWith("M")).toBe(true);
      expect(s.cx).toBeGreaterThan(0);
      expect(s.cx).toBeLessThan(US_VIEWBOX.width);
      expect(s.cy).toBeGreaterThan(0);
      expect(s.cy).toBeLessThan(US_VIEWBOX.height);
    }
  });
});

it("names a column for screen readers", () => {
  expect(columnName({ name: "California", formatted: "$28,410.00", count: 21, urgent: 2, unverified: false })).toBe(
    "California: $28,410.00 across 21 items, 2 due within 7 days or overdue",
  );
});
