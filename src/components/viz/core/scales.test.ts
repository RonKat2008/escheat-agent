import { describe, expect, it } from "vitest";
import { daysBetween, isoFromDay, niceTicks, scaleBand, scaleLinear, scaleTime } from "./scales";

describe("scaleLinear", () => {
  const s = scaleLinear([0, 10], [0, 100]);
  it("maps and inverts", () => {
    expect(s(5)).toBe(50);
    expect(s.invert(25)).toBe(2.5);
  });
  it("handles a zero-width domain", () => {
    expect(scaleLinear([3, 3], [10, 20])(3)).toBe(10);
  });
  it("produces nice ticks", () => {
    expect(niceTicks(0, 100, 5)).toEqual([0, 20, 40, 60, 80, 100]);
    expect(s.ticks(5)).toEqual([0, 2, 4, 6, 8, 10]);
  });
});

describe("scaleTime", () => {
  const s = scaleTime(["2024-01-01", "2024-01-11"], [0, 100]);
  it("maps UTC day math", () => {
    expect(s("2024-01-01")).toBe(0);
    expect(s("2024-01-06")).toBe(50);
    expect(s.invert(100)).toBe("2024-01-11");
  });
  it("is DST-safe across a spring-forward boundary", () => {
    expect(daysBetween("2024-03-09", "2024-03-11")).toBe(2);
    expect(isoFromDay(0)).toBe("1970-01-01");
  });
  it("ticks include both ends", () => {
    const t = s.ticks(2);
    expect(t[0]).toBe("2024-01-01");
    expect(t[t.length - 1]).toBe("2024-01-11");
  });
});

describe("scaleBand", () => {
  it("places keys with padding", () => {
    const s = scaleBand(["a", "b"], [0, 100], { padding: 0.2 });
    expect(s.step).toBe(50);
    expect(s.bandwidth).toBe(40);
    expect(s("a")).toBe(5);
    expect(s("b")).toBe(55);
    expect(Number.isNaN(s("zzz"))).toBe(true);
  });
});
