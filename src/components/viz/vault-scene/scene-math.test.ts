import { describe, expect, it } from "vitest";
import { placeLabels, restFrame, VAULT_ASPECT } from "./labels";
import {
  bezier,
  buildParticles,
  buildThreads,
  cameraAt,
  cameraKeys,
  curveUniform,
  CYCLE_S,
  damp,
  fpsVerdict,
  GATE_OPEN_S,
  GATE_U,
  gateHold,
  layoutSlabs,
  LEDGER_ITEMS,
  MAX_PARTICLES,
  particleCounts,
  particleState,
  project,
  pylonFill,
  pylonShare,
  sampleCurve,
  STALE_ITEMS,
  stepsToCamera,
  threadTime,
  tierSettings,
} from "./scene-math";

describe("slab layout", () => {
  it("lays out one slab per synthetic ledger row and lifts exactly the 47 stale ones, CA 21 / TX 15 / DE 11", () => {
    const s = layoutSlabs();
    expect(s.count).toBe(LEDGER_ITEMS);
    const byState = [0, 0, 0];
    let stale = 0;
    for (let i = 0; i < s.count; i++) {
      if (s.info[i * 3] === 1) {
        stale++;
        byState[s.info[i * 3 + 1]!]! += 1;
      }
    }
    expect(stale).toBe(STALE_ITEMS);
    expect(byState).toEqual([21, 15, 11]);
  });

  it("is deterministic and places state clusters west to east (CA, TX, DE)", () => {
    const a = layoutSlabs();
    const b = layoutSlabs();
    expect(Array.from(a.info)).toEqual(Array.from(b.info));
    expect(a.centroids.CA[0]).toBeLessThan(a.centroids.TX[0]);
    expect(a.centroids.TX[0]).toBeLessThan(a.centroids.DE[0]);
  });
});

describe("thread paths", () => {
  const curves = buildThreads(layoutSlabs());

  it("has three forward threads and one recovery thread", () => {
    expect(curves).toHaveLength(4);
    expect(curveUniform(curves)).toHaveLength(16);
    expect(curveUniform(curves)[0]).toEqual([...curves[0]!.p0]);
  });

  it("bezier hits its endpoints and sampleCurve includes both", () => {
    const c = curves[0]!;
    expect(bezier(c, 0)).toEqual(c.p0);
    bezier(c, 1).forEach((v, i) => expect(v).toBeCloseTo(c.p3[i]!, 10));
    const pts = sampleCurve(c, 5);
    expect(pts).toHaveLength(5);
    expect(pts[0]).toEqual(c.p0);
    expect(() => sampleCurve(c, 1)).toThrow(RangeError);
  });

  it("arcs above the floor between the slabs and the pylon", () => {
    for (const c of curves.slice(0, 3)) for (const p of sampleCurve(c, 32)) expect(p[1]).toBeGreaterThan(0);
  });
});

describe("timeline", () => {
  it("holds a particle at the gate until its release, then carries it on to the pylon", () => {
    const seed = 0.2;
    const seed2 = 0.5;
    const before = particleState(1.0, seed, seed2);
    expect(before.u).toBeGreaterThan(0);
    expect(before.u).toBeLessThan(GATE_U);
    const held = particleState(GATE_OPEN_S - 0.1, seed, seed2);
    expect(held.u).toBe(GATE_U);
    expect(held.hold).toBeCloseTo(1, 5);
    const after = particleState(CYCLE_S - 0.5, seed, seed2);
    expect(after.u).toBeGreaterThan(1);
    expect(after.hold).toBe(0);
  });

  it("not yet launched particles have u < 0", () => {
    expect(particleState(0, 0.9, 0).u).toBeLessThan(0);
  });

  it("the gate glows pink while light waits and is clear at the start and end of a cycle", () => {
    expect(gateHold(0)).toBe(0);
    expect(gateHold(GATE_OPEN_S - 0.2)).toBeCloseTo(1, 5);
    expect(gateHold(CYCLE_S - 0.1)).toBe(0);
  });

  it("pylons fill after release and empty before the loop restarts", () => {
    expect(pylonFill(1)).toBe(0);
    expect(pylonFill(8.2)).toBeGreaterThan(0.9);
    expect(pylonFill(CYCLE_S)).toBe(0);
    expect(pylonShare("CA")).toBe(1);
    expect(pylonShare("DE")).toBeCloseTo(11 / 21, 10);
  });

  it("threadTime wraps into [0, CYCLE_S)", () => {
    expect(threadTime(CYCLE_S + 1, 0)).toBeCloseTo(1, 10);
    expect(threadTime(-1, 0)).toBeCloseTo(CYCLE_S - 1, 10);
  });
});

describe("particles", () => {
  it("splits the budget by stale share and caps it at 600", () => {
    const counts = particleCounts();
    expect(counts.reduce((a, b) => a + b, 0)).toBe(MAX_PARTICLES);
    expect(counts[0]).toBeGreaterThan(counts[1]!);
    expect(counts[1]).toBeGreaterThan(counts[2]!);
  });

  it("interleaves threads so the lite prefix (half) still covers every thread", () => {
    const p = buildParticles();
    const half = MAX_PARTICLES / 2;
    const seen = new Set<number>();
    for (let i = 0; i < half; i++) seen.add(p.data[i * 3]!);
    expect([...seen].sort()).toEqual([0, 1, 2, 3]);
  });
});

describe("camera", () => {
  const keys = cameraKeys(buildThreads(layoutSlabs()));

  it("has a rest frame plus four step keyframes and clamps outside them", () => {
    expect(keys).toHaveLength(5);
    expect(cameraAt(keys, -3)).toEqual(keys[0]);
    expect(cameraAt(keys, 0)).toEqual(keys[0]);
    expect(cameraAt(keys, 4)).toEqual(keys[4]);
    expect(cameraAt(keys, 9)).toEqual(keys[4]);
  });

  it("maps scroll progress to camera progress in [0, 4]", () => {
    expect(stepsToCamera(0)).toBe(0);
    expect(stepsToCamera(-1)).toBe(0);
    expect(stepsToCamera(1)).toBe(4);
    expect(stepsToCamera(0.5)).toBeCloseTo(2.25, 10);
  });

  it("damps toward the target without overshoot", () => {
    const v = damp(0, 1, 3.2, 1 / 60);
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThan(1);
    expect(damp(0, 1, 3.2, 10)).toBeCloseTo(1, 5);
  });

  it("projects the look-at target to the centre and points behind the camera to null", () => {
    const p = project(keys[0]!.target, keys[0]!, 1.6);
    expect(p!.x).toBeCloseTo(0.5, 6);
    expect(p!.y).toBeCloseTo(0.5, 6);
    const behind = keys[0]!.pos.map((v, i) => v + (keys[0]!.pos[i]! - keys[0]!.target[i]!)) as [number, number, number];
    expect(project(behind, keys[0]!, 1.6)).toBeNull();
  });

  it("places every rest-frame label inside the poster", () => {
    const { labels, rest } = restFrame();
    for (const l of placeLabels(labels, rest, VAULT_ASPECT)) expect(l.visible).toBe(true);
  });
});

describe("tiers", () => {
  it("full clamps DPR to 2 with all particles; lite uses DPR 1 and half; static draws nothing", () => {
    expect(tierSettings("full", 3)).toEqual({ dprCap: 2, particles: 600 });
    expect(tierSettings("full", 1)).toEqual({ dprCap: 1, particles: 600 });
    expect(tierSettings("lite", 2)).toEqual({ dprCap: 1, particles: 300 });
    expect(tierSettings("static", 2).particles).toBe(0);
  });

  it("FPS probe: < 30fps back to the poster, < 50fps lite, otherwise unchanged; never upgrades", () => {
    const frames = (fps: number) => Array.from({ length: 90 }, () => 1000 / fps);
    expect(fpsVerdict(frames(60), "full")).toBe("full");
    expect(fpsVerdict(frames(45), "full")).toBe("lite");
    expect(fpsVerdict(frames(20), "full")).toBe("static");
    expect(fpsVerdict(frames(60), "lite")).toBe("lite");
    expect(fpsVerdict(frames(10), "static")).toBe("static");
    expect(fpsVerdict([], "full")).toBe("full");
  });
});
