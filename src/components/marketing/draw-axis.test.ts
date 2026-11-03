import { describe, expect, it } from "vitest";
import { drawAxis } from "./draw-axis";

describe("drawAxis", () => {
  it("draws horizontal lines along x", () => {
    expect(drawAxis("M 0 6 H 100")).toBe("x");
    expect(drawAxis("M 8 12 H 992")).toBe("x");
    expect(drawAxis("M0 6h100")).toBe("x");
  });

  it("draws vertical lines along y", () => {
    expect(drawAxis("M 6 0 V 100")).toBe("y");
    expect(drawAxis("M6 0v100")).toBe("y");
  });

  it("falls back to x for anything else", () => {
    expect(drawAxis("M 0 0 L 10 10")).toBe("x");
    expect(drawAxis("M 0 0 H 10 V 10")).toBe("x");
  });
});
