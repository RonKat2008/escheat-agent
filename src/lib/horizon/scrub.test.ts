import { describe, expect, it } from "vitest";
import type { HorizonItem } from "./project";
import { bucketsAt, clampOffset, isInScope, remainingAt, splitByScope } from "./scrub";

const mk = (id: string, daysUntilStale: number, amountCents: number, ownerState: string | null): HorizonItem =>
  ({ ledgerItemId: id, daysUntilStale, amountCents, ownerState }) as HorizonItem;
const items = [mk("a", 5, 1_000, "TX"), mk("b", 40, 2_000, "CA"), mk("c", 100, 4_000, "FL"), mk("d", 200, 8_000, null), mk("e", 300, 16_000, "DE")];
const sumCents = (b: ReturnType<typeof bucketsAt>) => b.buckets.reduce((s, x) => s + x.cents, 0) + b.staleByThen.cents;
const sumCount = (b: ReturnType<typeof bucketsAt>) => b.buckets.reduce((s, x) => s + x.count, 0) + b.staleByThen.count;

describe("scrubber projection", () => {
  it("clamps the offset to 0..365", () => {
    expect([clampOffset(-5), clampOffset(900), clampOffset(NaN), clampOffset(30.9)]).toEqual([0, 365, 0, 30]);
  });

  it("remaining days shrink with the offset and stop at 0 (already stale)", () => {
    expect(remainingAt(items[0]!, 0)).toBe(5);
    expect(remainingAt(items[0]!, 5)).toBe(0);
    expect(remainingAt(items[4]!, 90)).toBe(210);
  });

  it("offset 0 equals the plain buckets and nothing is stale yet", () => {
    const b = bucketsAt(items, 0);
    expect(b.staleByThen).toEqual({ count: 0, cents: 0 });
    expect(b.buckets.map((x) => x.count)).toEqual([1, 1, 0, 3]);
  });

  it("buckets move with the scrubber and always tie to the worklist total", () => {
    const seen = new Set<string>();
    for (const off of [0, 30, 90, 180, 365]) {
      const b = bucketsAt(items, off);
      expect(sumCents(b)).toBe(31_000);
      expect(sumCount(b)).toBe(items.length);
      seen.add(JSON.stringify(b.buckets.map((x) => x.count)));
    }
    expect(seen.size).toBeGreaterThan(2);
    expect(bucketsAt(items, 90).staleByThen).toEqual({ count: 2, cents: 3_000 });
    expect(bucketsAt(items, 365).staleByThen.count).toBe(items.length);
  });
});

describe("scope", () => {
  const rules = ["CA", "DE", "TX"];
  it("only states with rules loaded are in scope; unknown and unsupported are not", () => {
    expect(items.map((i) => isInScope(i, rules))).toEqual([true, true, false, false, true]);
  });

  it("groups out-of-scope payments by state with counts and amounts, losing none", () => {
    const s = splitByScope([...items, mk("f", 9, 500, "FL"), mk("g", 9, 700, "IL")], rules);
    expect(s.inScope.length + s.outOfScope.length).toBe(7);
    expect(s.groups).toEqual([
      { state: null, count: 1, cents: 8_000 },
      { state: "FL", count: 2, cents: 4_500 },
      { state: "IL", count: 1, cents: 700 },
    ]);
    expect(s.outOfScopeCents).toBe(13_200);
  });
});
