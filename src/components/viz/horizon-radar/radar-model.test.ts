import { describe, expect, it } from "vitest";
import { buildRings, DOT_MAX_PX, DOT_MIN_PX, dotSize, layoutDots, makeScale, motionFor, R_DOT_MAX, R_ISSUED, radiusForDays } from "./radar-model";

const scale = makeScale(180, [1096, 1826]);

describe("radar model", () => {
  it("ring radii are strictly increasing with days", () => {
    const rings = buildRings(scale, [
      { days: 1826, label: "DE", unverified: true },
      { days: 1096, label: "CA, TX", unverified: true },
    ]);
    expect(rings.map((r) => r.kind)).toEqual(["issued", "mid", "stale", "dormancy", "dormancy"]);
    expect(rings.map((r) => r.days)).toEqual([0, 90, 180, 1096, 1826]);
    for (let i = 1; i < rings.length; i++) expect(rings[i]!.r).toBeGreaterThan(rings[i - 1]!.r);
    expect(rings.find((r) => r.kind === "stale")?.note).toBe("business policy, not law");
  });

  it("the day->radius scale is monotonic and clamped", () => {
    let prev = -1;
    for (let d = -50; d <= 4000; d += 7) {
      const r = radiusForDays(d, scale);
      expect(r).toBeGreaterThanOrEqual(prev);
      expect(r).toBeGreaterThanOrEqual(R_ISSUED);
      expect(r).toBeLessThanOrEqual(R_DOT_MAX);
      prev = r;
    }
  });

  it("dot positions stay on the plane even far past the last ring", () => {
    const dots = layoutDots(
      Array.from({ length: 40 }, (_, i) => ({ id: String(i), ageDays: i * 200, amountCents: 100 * (i + 1) })),
      scale,
      9999,
    );
    for (const d of dots) {
      expect(Math.abs(d.x)).toBeLessThanOrEqual(R_DOT_MAX);
      expect(Math.abs(d.y)).toBeLessThanOrEqual(R_DOT_MAX);
    }
  });

  it("the scrubber moves dots outward along their spoke", () => {
    const items = [{ id: "a", ageDays: 30, amountCents: 100 }];
    const [now] = layoutDots(items, scale, 0);
    const [later] = layoutDots(items, scale, 90);
    expect(later!.r).toBeGreaterThan(now!.r);
    expect(Math.atan2(later!.y, later!.x)).toBeCloseTo(Math.atan2(now!.y, now!.x));
  });

  it("dot size grows with amount within bounds", () => {
    expect(dotSize(0, 1000)).toBe(DOT_MIN_PX);
    expect(dotSize(1000, 1000)).toBe(DOT_MAX_PX);
    expect(dotSize(250, 1000)).toBeGreaterThan(DOT_MIN_PX);
    expect(dotSize(5, 0)).toBe(DOT_MIN_PX);
  });

  it("the reduced-motion (static) tier is fully static", () => {
    expect(motionFor("static")).toEqual({ tilt: false, sweep: false, transitions: false });
    expect(motionFor("lite").sweep).toBe(false);
    expect(motionFor("full")).toEqual({ tilt: true, sweep: true, transitions: true });
  });
});
