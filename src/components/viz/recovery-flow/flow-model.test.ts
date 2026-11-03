import { describe, expect, it } from "vitest";
import { layoutRecoveryFlow } from "./flow-layout";
import { buildRecoveryFlow, nodeBalance, pathOf, type RecoveryFlowRow } from "./flow-model";

const row = (state: string, status: RecoveryFlowRow["status"], amountCents: number, approved = false): RecoveryFlowRow => ({ state, status, amountCents, approved });

const ROWS: RecoveryFlowRow[] = [
  row("TX", "found", 118_000),
  row("TX", "awaiting_approval", 5_000, true),
  row("CA", "claim_submitted", 42_500, true),
  row("CA", "paid", 10_000, true),
  row("DE", "rejected", 2_000, true),
];

describe("recovery flow model", () => {
  it("conserves money: for every node with both sides, incoming cents equal outgoing cents", () => {
    const model = buildRecoveryFlow(ROWS);
    const balance = nodeBalance(model);
    let checked = 0;
    for (const [, b] of balance) {
      if (b.in > 0 && b.out > 0) {
        expect(b.in).toBe(b.out);
        checked += 1;
      }
    }
    expect(checked).toBe(2); // found, claimed
    // sources (portals) and sinks sum to the same total
    const sources = model.links.filter((l) => l.source.startsWith("portal:")).reduce((a, l) => a + l.cents, 0);
    const sinkIds = model.nodes.filter((n) => !model.links.some((l) => l.source === n.id)).map((n) => n.id);
    const sinks = model.links.filter((l) => sinkIds.includes(l.target)).reduce((a, l) => a + l.cents, 0);
    expect(sources).toBe(model.totalCents);
    expect(sinks).toBe(model.totalCents);
    expect(model.totalCents).toBe(177_500);
  });

  it("routes each status honestly and never back-fills a stage with no rows", () => {
    expect(pathOf(row("tx", "found", 1))).toEqual(["portal:TX", "found", "needs_you"]);
    expect(pathOf(row("TX", "claim_drafted", 1, true))).toEqual(["portal:TX", "found", "approved"]);
    expect(pathOf(row("TX", "claim_submitted", 1, true))).toEqual(["portal:TX", "found", "claimed", "pending"]);
    const onlyFound = buildRecoveryFlow([row("TX", "found", 500)]);
    expect(onlyFound.nodes.map((n) => n.id)).toEqual(["portal:TX", "found", "needs_you"]);
    expect(onlyFound.links).toHaveLength(2);
  });

  it("drops zero-amount rows and therefore zero links, and is empty for no rows", () => {
    const model = buildRecoveryFlow([row("TX", "paid", 0), row("CA", "found", 100)]);
    expect(model.links.every((l) => l.cents > 0)).toBe(true);
    expect(model.nodes.some((n) => n.id === "paid" || n.id === "portal:TX")).toBe(false);
    expect(buildRecoveryFlow([])).toEqual({ nodes: [], links: [], totalCents: 0, totalCount: 0 });
  });

  it("counts items alongside cents on nodes and links", () => {
    const model = buildRecoveryFlow(ROWS);
    expect(model.nodes.find((n) => n.id === "found")).toMatchObject({ cents: 177_500, count: 5 });
    expect(model.links.find((l) => l.source === "portal:CA")).toMatchObject({ cents: 52_500, count: 2 });
  });

  it("lays out left to right by stage with link widths proportional to cents", () => {
    const layout = layoutRecoveryFlow(buildRecoveryFlow(ROWS), 600, 200);
    const x = (id: string) => layout.nodes.find((n) => n.id === id)!.x0;
    expect(x("portal:CA")).toBeLessThan(x("found"));
    expect(x("found")).toBeLessThan(x("claimed"));
    expect(x("claimed")).toBeLessThan(x("paid"));
    expect(x("needs_you")).toBe(x("claimed"));
    const big = layout.links.find((l) => l.target.id === "needs_you")!;
    const small = layout.links.find((l) => l.target.id === "paid")!;
    expect(big.width / small.width).toBeCloseTo(118_000 / 10_000, 5);
    expect(layout.links.every((l) => l.path.startsWith("M"))).toBe(true);
    expect(layoutRecoveryFlow(buildRecoveryFlow([]), 600, 200).nodes).toEqual([]);
  });
});
