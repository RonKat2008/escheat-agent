import { describe, expect, it } from "vitest";
import { buildMoneyFlow, type FlowInput } from "@/lib/queries/flow";
import type { IsoDate } from "@/lib/dates";
import { cardWidth, flowScale, flowSignature, horizontalPath, layoutFlow, particleBudget, rowSegments, stackCards } from "./sankey-model";

/** Shaped like the demo seed: $61,915 stale across CA/TX/DE, a late TX slice and a $348 sliver. */
const input: FlowInput = {
  asOf: "2026-11-01" as IsoDate,
  ledger: { stale: { cents: 6_191_500, count: 47 }, notStale: { cents: 1_000_000, count: 9 }, cleared: { cents: 117_527_900, count: 677 } },
  stale: [
    { state: "CA", status: "watching", cents: 2_492_590, count: 20, urgent: 0, awaiting: 0, unverified: 0 },
    { state: "CA", status: "dd_pending", cents: 348_410, count: 2, urgent: 0, awaiting: 2, unverified: 0 },
    { state: "TX", status: "to_report", cents: 1_200_000, count: 6, urgent: 0, awaiting: 0, unverified: 6 },
    { state: "TX", status: "watching", cents: 786_200, count: 6, urgent: 0, awaiting: 0, unverified: 0 },
    { state: "DE", status: "watching", cents: 1_329_500, count: 11, urgent: 0, awaiting: 0, unverified: 0 },
    { state: "DE", status: "needs_rule", cents: 34_800, count: 2, urgent: 0, awaiting: 0, unverified: 2 },
  ],
  recoveries: [],
  late: [{ state: "TX", status: "to_report", cents: 77_374, count: 3 }],
  lateInterest: { cents: 2607, verified: false, unknownStates: [] },
};
const flow = buildMoneyFlow(input);
const main = { nodes: flow.nodes.filter((n) => n.band === "main"), links: flow.links.filter((l) => l.band === "main") };

describe("stackCards (width-independent vertical layout)", () => {
  it("gives the fullest column the scale and every card at least its minimum", () => {
    const { k, boxes } = stackCards(main.nodes, { scalePx: 240, minCard: 44, minLateCard: 60 });
    expect(k).toBeCloseTo(240 / 6_191_500, 12);
    expect(boxes.get("stale")!.h).toBe(240);
    for (const n of main.nodes) expect(boxes.get(n.id)!.h).toBeGreaterThanOrEqual(n.kind === "late" || n.unverified > 0 ? 60 : 44);
  });

  it("never overlaps two cards in a column and keeps every card inside the height", () => {
    const { height, boxes } = stackCards(main.nodes, { gap: 12 });
    for (const c of [0, 1, 2]) {
      const col = [...boxes.values()].filter((b) => b.column === c).sort((a, b) => a.y - b.y);
      for (let i = 1; i < col.length; i++) expect(col[i]!.y).toBeGreaterThanOrEqual(col[i - 1]!.y + col[i - 1]!.h + 12 - 0.1);
      for (const b of col) {
        expect(b.y).toBeGreaterThanOrEqual(0);
        expect(b.y + b.h).toBeLessThanOrEqual(height + 0.1);
      }
    }
  });

  it("scales to zero for an empty flow", () => {
    expect(flowScale([])).toBe(0);
    expect(stackCards([]).height).toBeGreaterThanOrEqual(0);
  });
});

describe("layoutFlow", () => {
  it("does not depend on the width for its height or band thickness", () => {
    const a = layoutFlow(main.nodes, main.links, 700);
    const b = layoutFlow(main.nodes, main.links, 1200);
    expect(a.height).toBe(b.height);
    expect(a.bands.map((x) => x.width)).toEqual(b.bands.map((x) => x.width));
  });

  it("keeps cards inside the width with the first and last columns at the edges", () => {
    const l = layoutFlow(main.nodes, main.links, 900);
    for (const c of l.cards) {
      expect(c.x).toBeGreaterThanOrEqual(0);
      expect(c.x + c.w).toBeLessThanOrEqual(900 + 0.1);
    }
    expect(l.cards.find((c) => c.id === "stale")!.x).toBe(0);
    expect(l.cards.find((c) => c.id === "late")!.x + l.cards[0]!.w).toBeCloseTo(900, 0);
  });

  it("makes band thickness proportional to cents (above the minimum) and runs bands edge to edge", () => {
    const l = layoutFlow(main.nodes, main.links, 900, { minBand: 2 });
    const k = flowScale(main.nodes);
    for (const b of l.bands) {
      expect(b.width).toBeCloseTo(Math.max(2, b.cents * k), 0);
      const s = l.cards.find((c) => c.id === b.source)!;
      const t = l.cards.find((c) => c.id === b.target)!;
      expect(b.sx).toBeCloseTo(s.x + s.w, 1);
      expect(b.tx).toBeCloseTo(t.x, 1);
      expect(b.d.startsWith(`M${Math.round(b.sx * 10) / 10},`)).toBe(true);
    }
  });

  it("stacks a card's outgoing bands without overlap, centred on the card", () => {
    const l = layoutFlow(main.nodes, main.links, 900);
    const out = l.bands.filter((b) => b.source === "stale").sort((a, b) => a.sy - b.sy);
    for (let i = 1; i < out.length; i++) expect(out[i]!.sy - out[i]!.width / 2).toBeGreaterThanOrEqual(out[i - 1]!.sy + out[i - 1]!.width / 2 - 0.2);
    const s = l.cards.find((c) => c.id === "stale")!;
    expect(out[0]!.sy - out[0]!.width / 2).toBeGreaterThanOrEqual(s.y - 0.2);
    expect(out.at(-1)!.sy + out.at(-1)!.width / 2).toBeLessThanOrEqual(s.y + s.h + 0.2);
  });

  it("returns no geometry until the width is measured", () => {
    expect(layoutFlow(main.nodes, main.links, 0).cards).toEqual([]);
  });

  it("card width stays readable and leaves room for bands", () => {
    expect(cardWidth(640, 3)).toBe(118);
    expect(cardWidth(1400, 3)).toBe(184);
    expect(cardWidth(300, 1)).toBe(300);
  });
});

describe("rowSegments (phone stacked bars)", () => {
  it("splits a state's money by where it goes, summing to 100%, with small slices kept visible", () => {
    const segs = rowSegments(main.links, "state:TX", 3);
    expect(segs.map((s) => s.link.target).sort()).toEqual(["late", "to_report", "watching"]);
    expect(segs.reduce((a, s) => a + s.pct, 0)).toBeCloseTo(100, 6);
    for (const s of segs) expect(s.pct).toBeGreaterThanOrEqual(3);
    expect(rowSegments(main.links, "nope")).toEqual([]);
  });
});

describe("helpers", () => {
  it("flowSignature changes with the figures only", () => {
    expect(flowSignature(main.nodes)).toBe(flowSignature([...main.nodes]));
    expect(flowSignature([{ id: "a", cents: 1, count: 1 }])).not.toBe(flowSignature([{ id: "a", cents: 2, count: 1 }]));
  });

  it("horizontalPath is a cubic from source to target", () => {
    expect(horizontalPath(0, 10, 100, 50)).toBe("M0,10C50,10 50,50 100,50");
  });

  it("particleBudget caps per link and in total", () => {
    expect(particleBudget([{ count: 1 }, { count: 20 }])).toEqual([1, 4]);
    const many = particleBudget(Array.from({ length: 20 }, () => ({ count: 8 })));
    expect(many.reduce((a, n) => a + n, 0)).toBeLessThanOrEqual(36);
  });
});
