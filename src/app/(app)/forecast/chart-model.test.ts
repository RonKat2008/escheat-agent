import { describe, expect, it } from "vitest";
import { barPath, fillFor, monthTotal, shareLabel, tick, topStateOf } from "./chart-model";

const STATES = ["CA", "DE", "TX"];

describe("forecast chart model", () => {
  it("formats compact axis ticks in whole dollars", () => {
    expect(tick(0)).toBe("$0");
    expect(tick(99_900)).toBe("$999");
    expect(tick(150_000)).toBe("$1.5k");
    expect(tick(200_000)).toBe("$2k");
    expect(tick(1_250_000)).toBe("$13k");
    expect(tick(250_000_000)).toBe("$2.5M");
  });

  it("totals a month across the shown states only", () => {
    expect(monthTotal({ cents: { CA: 100, TX: 50, NY: 999 } }, STATES)).toBe(150);
  });

  it("finds the top non-empty segment of a stack", () => {
    expect(topStateOf({ cents: { CA: 1, DE: 0, TX: 5 } }, STATES)).toBe("TX");
    expect(topStateOf({ cents: { CA: 1, DE: 2 } }, STATES)).toBe("DE");
    expect(topStateOf({ cents: {} }, STATES)).toBeNull();
  });

  it("draws square segments and rounds only the top, clamping the radius", () => {
    expect(barPath(10, 20, 30, 40, 3, false)).toBe("M10,20h30v40h-30Z");
    expect(barPath(10, 20, 30, 40, 3, true)).toBe("M10,60V23Q10,20 13,20H37Q40,20 40,23V60Z");
    // radius larger than the bar is clamped to the height
    expect(barPath(0, 0, 10, 1, 4, true)).toBe("M0,1V1Q0,0 1,0H9Q10,0 10,1V1Z");
    expect(barPath(0, 0, 0, 10, 2, true)).toBe("");
    expect(barPath(0, 0, 10, Number.NaN, 2, true)).toBe("");
  });

  it("labels shares without implying precision it does not have", () => {
    expect(shareLabel(50, 200)).toBe("25%");
    expect(shareLabel(1, 1000)).toBe("<1%");
    expect(shareLabel(0, 100)).toBe("0%");
    expect(shareLabel(5, 0)).toBe("0%");
  });

  it("keeps a fixed fill per state so filters never recolour a series", () => {
    expect(fillFor("CA")).toBe("var(--color-blue-500)");
    expect(fillFor("TX")).toBe("var(--color-blue-300)");
    expect(fillFor("ZZ")).toBe("rgb(255 255 255 / 0.3)");
  });
});
