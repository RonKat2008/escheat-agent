import { describe, expect, test } from "vitest";
import { causePathEffect, DUR, DUR_S, exitMs, listDelayMs, nodeDelayMs, SPRING } from "./tokens";

describe("motion tokens", () => {
  test("durations match the spec table and the seconds mirror", () => {
    expect(DUR).toEqual({ instant: 90, fast: 150, base: 240, slow: 400, draw: 900, num: 700, hero: 1400 });
    expect(DUR_S.draw).toBe(0.9);
  });

  test("list stagger is 30ms, capped at 8 items", () => {
    expect(listDelayMs(0)).toBe(0);
    expect(listDelayMs(3)).toBe(90);
    expect(listDelayMs(20)).toBe(240);
    expect(listDelayMs(-1)).toBe(0);
  });

  test("diagram nodes stagger at 60ms, capped at 10", () => {
    expect(nodeDelayMs(10)).toBe(600);
    expect(nodeDelayMs(50)).toBe(600);
  });

  test("exits are 0.66 x the entrance", () => {
    expect(exitMs(240)).toBe(158);
  });

  test("cause, path, effect are chained in order", () => {
    const t = causePathEffect(100);
    expect(t.source).toBe(100);
    expect(t.path).toBe(220);
    expect(t.effect).toBe(220 + DUR.draw);
    expect(t.end).toBeGreaterThan(t.effect);
  });

  test("only the stamp spring is underdamped enough to overshoot", () => {
    const ratio = (s: { stiffness: number; damping: number; mass?: number }) => s.damping / (2 * Math.sqrt(s.stiffness * (s.mass ?? 1)));
    expect(ratio(SPRING.stamp)).toBeLessThan(ratio(SPRING.sheet));
  });
});
