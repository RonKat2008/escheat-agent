import { describe, expect, it } from "vitest";
import { MINUS, signedDisplay, waterfallModel, type WaterfallStep } from "./waterfall-model";

const steps: WaterfallStep[] = [
  { id: "opening", label: "Opening", cents: 4_294_732, direction: "total" },
  { id: "identified", label: "Identified", cents: 1_896_768, direction: "up" },
  { id: "resolved", label: "Resolved", cents: 0, direction: "down" },
  { id: "remitted", label: "Remitted", cents: 77_374, direction: "down" },
  { id: "closing", label: "Closing", cents: 6_114_126, direction: "total" },
];

describe("waterfallModel", () => {
  const m = waterfallModel(steps);

  it("floats movement bars on the running balance and grounds the totals", () => {
    expect(m.bars.map((b) => [b.from, b.to])).toEqual([
      [0, 4_294_732],
      [4_294_732, 6_191_500],
      [6_191_500, 6_191_500],
      [6_191_500, 6_114_126],
      [0, 6_114_126],
    ]);
    expect(m.max).toBe(6_191_500);
    expect(m.reconciles).toBe(true);
  });

  it("positions as % of the tallest running balance", () => {
    const id = m.bars[1]!;
    expect(id.bottomPct + id.heightPct).toBeCloseTo(100);
    const rem = m.bars[3]!;
    expect(rem.bottomPct).toBeCloseTo((6_114_126 / 6_191_500) * 100);
    expect(m.bars[2]!.heightPct).toBe(0);
    expect(m.bars[0]!.bottomPct).toBe(0);
  });

  it("labels: totals plain, increases +, decreases with a real minus sign", () => {
    expect(m.bars.map((b) => b.display)).toEqual(["$42,947.32", "+$18,967.68", "$0.00", `${MINUS}$773.74`, "$61,141.26"]);
    expect(signedDisplay("down", 77_374)).toBe("−$773.74");
  });

  it("flags a closing that does not equal opening plus the movements", () => {
    expect(waterfallModel([...steps.slice(0, 4), { id: "closing", label: "Closing", cents: 1, direction: "total" }]).reconciles).toBe(false);
  });

  it("keeps a zero scale finite", () => {
    const z = waterfallModel([{ id: "o", label: "O", cents: 0, direction: "total" }]);
    expect(z.max).toBe(1);
    expect(z.bars[0]!.heightPct).toBe(0);
  });
});
