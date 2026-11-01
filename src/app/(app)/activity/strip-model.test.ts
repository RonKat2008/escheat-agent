import { describe, expect, it } from "vitest";
import { buildDensity } from "@/lib/queries/activity";
import { barHeightPct, inRange, MIN_BAR_PCT, stripCaption } from "./strip-model";

const fmt = (iso: string) => iso.slice(5);

describe("activity strip model", () => {
  it("scales bars by square root with a visible minimum, and draws nothing for empty days", () => {
    expect(barHeightPct(0, 10)).toBe(0);
    expect(barHeightPct(10, 10)).toBe(100);
    expect(barHeightPct(1, 4)).toBe(50);
    expect(barHeightPct(1, 1000)).toBe(MIN_BAR_PCT);
    expect(barHeightPct(20, 10)).toBe(100);
  });

  it("treats a missing bound as open", () => {
    expect(inRange("2026-10-05")).toBe(true);
    expect(inRange("2026-10-05", "2026-10-05", "2026-10-05")).toBe(true);
    expect(inRange("2026-10-04", "2026-10-05")).toBe(false);
    expect(inRange("2026-10-06", undefined, "2026-10-05")).toBe(false);
  });

  it("captions the busiest day, a single active day, attention, and an empty window", () => {
    const busy = buildDensity(
      [
        { day: "2026-10-02", count: 3, attention: 1 },
        { day: "2026-10-03", count: 1, attention: 0 },
      ],
      "2026-10-03",
      5,
    );
    expect(stripCaption(busy, fmt)).toBe("Busiest 10-02 with 3. 1 needs attention.");
    const one = buildDensity([{ day: "2026-10-03", count: 4, attention: 0 }], "2026-10-03", 5);
    expect(stripCaption(one, fmt)).toBe("All on 10-03.");
    const two = buildDensity([{ day: "2026-10-03", count: 4, attention: 2 }], "2026-10-03", 5);
    expect(stripCaption(two, fmt)).toBe("All on 10-03. 2 need attention.");
    expect(stripCaption(buildDensity([], "2026-10-03", 5), fmt)).toBe("Nothing recorded in this window.");
  });
});
