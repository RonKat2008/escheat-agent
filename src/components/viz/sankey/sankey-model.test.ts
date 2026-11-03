import { describe, expect, it } from "vitest";
import { buildMoneyFlow, type FlowInput } from "@/lib/queries/flow";
import type { IsoDate } from "@/lib/dates";
import { horizontalPath, layoutSankey, particleBudget, shortLabel, verticalPath } from "./sankey-model";

const input: FlowInput = {
  asOf: "2026-11-01" as IsoDate,
  ledger: { stale: { cents: 6000, count: 4 }, notStale: { cents: 1000, count: 1 }, cleared: { cents: 3000, count: 2 } },
  stale: [
    { state: "CA", status: "watching", cents: 1000, count: 1, urgent: 0, awaiting: 0, unverified: 0 },
    { state: "CA", status: "to_report", cents: 2000, count: 1, urgent: 1, awaiting: 0, unverified: 0 },
    { state: "TX", status: "dd_sent", cents: 1500, count: 1, urgent: 0, awaiting: 0, unverified: 0 },
    { state: "DE", status: "resolved_paid", cents: 1500, count: 1, urgent: 0, awaiting: 0, unverified: 0 },
  ],
  recoveries: [{ state: "TX", status: "paid", cents: 800, count: 1 }],
};
const flow = buildMoneyFlow(input);
const main = (f = flow) => ({ nodes: f.nodes.filter((n) => n.band === "main"), links: f.links.filter((l) => l.band === "main") });

describe("layoutSankey", () => {
  it("places columns left to right inside the box, and link widths are proportional to cents", () => {
    const { nodes, links } = main();
    const l = layoutSankey(nodes, links, { width: 1000, height: 300, labelGutter: 150 });
    const col = (id: string) => l.nodes.find((n) => n.id === id)!;
    expect(col("ledger").x0).toBeLessThan(col("stale").x0);
    expect(col("stale").x0).toBeLessThan(col("state:CA").x0);
    expect(col("state:CA").x0).toBeLessThan(col("watching").x0);
    for (const n of l.nodes) {
      expect(n.x0).toBeGreaterThanOrEqual(0);
      expect(n.x1).toBeLessThanOrEqual(1000 - 150 + 1);
      expect(n.y0).toBeGreaterThanOrEqual(0);
      expect(n.y1).toBeLessThanOrEqual(300);
    }
    const w = (s: string, t: string) => l.links.find((x) => x.source === s && x.target === t)!.width;
    expect(w("state:CA", "to_report") / w("state:CA", "watching")).toBeCloseTo(2, 5);
    // A node's height is the band it carries.
    const ca = col("state:CA");
    expect(ca.y1 - ca.y0).toBeCloseTo(w("stale", "state:CA"), 5);
  });

  it("transposes for the vertical layout: flow runs top to bottom", () => {
    const { nodes, links } = main();
    const l = layoutSankey(nodes, links, { width: 340, height: 600 }, "vertical");
    const col = (id: string) => l.nodes.find((n) => n.id === id)!;
    expect(col("ledger").y0).toBeLessThan(col("stale").y0);
    expect(col("stale").y0).toBeLessThan(col("watching").y0);
    expect(l.nodes.every((n) => n.x1 <= 340 && n.y1 <= 600 && n.labelSide === "below")).toBe(true);
    expect(l.links[0]!.d.startsWith("M")).toBe(true);
  });

  it("mirrors the recovery band so it reads right to left", () => {
    const nodes = flow.nodes.filter((n) => n.band === "recovery");
    const links = flow.links.filter((l) => l.band === "recovery");
    const l = layoutSankey(nodes, links, { width: 600, height: 60, labelGutter: 120 }, "horizontal", true);
    const portals = l.nodes.find((n) => n.id === "portals")!;
    const recovered = l.nodes.find((n) => n.id === "recovered")!;
    expect(portals.x0).toBeGreaterThan(recovered.x0);
    expect(recovered.x0).toBeGreaterThanOrEqual(120);
  });

  it("returns an empty layout for an empty flow instead of throwing", () => {
    expect(layoutSankey([], [], { width: 100, height: 100 }).nodes).toEqual([]);
  });
});

describe("paths and helpers", () => {
  it("builds cubic centerlines from source to target", () => {
    expect(horizontalPath(0, 10, 100, 50)).toBe("M0,10C50,10 50,50 100,50");
    expect(verticalPath(10, 0, 50, 100)).toBe("M10,0C10,50 50,50 50,100");
  });

  it("caps particles per link and in total", () => {
    expect(particleBudget([{ count: 1 }, { count: 20 }])).toEqual([1, 4]);
    const many = particleBudget(Array.from({ length: 20 }, () => ({ count: 9 })));
    expect(many.reduce((a, n) => a + n, 0)).toBeLessThanOrEqual(36);
  });

  it("shortens labels for the narrow layout", () => {
    expect(shortLabel({ id: "state:CA", label: "At risk: CA", kind: "state", state: "CA" })).toBe("CA");
    expect(shortLabel({ id: "dd", label: "In due diligence", kind: "status" })).toBe("In DD");
  });
});
