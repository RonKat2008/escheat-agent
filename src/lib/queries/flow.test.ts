import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/db/client";
import { ledgerItems, recoveries } from "@/db/schema";
import type { IsoDate } from "@/lib/dates";
import { buildMoneyFlow, getMoneyFlow, type FlowInput, type MoneyFlow } from "./flow";
import { getExposure } from "./exposure";
import { insertFixture, STANDARD_ITEMS } from "./test-fixtures";

/** Every node with both incoming and outgoing links carries the same cents and count through. */
function expectConserved(f: MoneyFlow) {
  for (const n of f.nodes) {
    const inc = f.links.filter((l) => l.target === n.id);
    const out = f.links.filter((l) => l.source === n.id);
    if (inc.length === 0 || out.length === 0) continue;
    expect(inc.reduce((a, l) => a + l.cents, 0), `cents through ${n.id}`).toBe(out.reduce((a, l) => a + l.cents, 0));
    expect(inc.reduce((a, l) => a + l.count, 0), `count through ${n.id}`).toBe(out.reduce((a, l) => a + l.count, 0));
  }
}

const zero = { cents: 0, count: 0 };
const base = (over: Partial<FlowInput> = {}): FlowInput => ({
  asOf: "2026-11-01" as IsoDate,
  ledger: { stale: { cents: 6000, count: 4 }, notStale: { cents: 500, count: 1 }, cleared: { cents: 9000, count: 3 } },
  stale: [
    { state: "CA", status: "watching", cents: 1000, count: 1, urgent: 0, awaiting: 0, unverified: 0 },
    { state: "CA", status: "to_report", cents: 2000, count: 1, urgent: 1, awaiting: 0, unverified: 1 },
    { state: "TX", status: "dd_sent", cents: 1500, count: 1, urgent: 0, awaiting: 1, unverified: 0 },
    { state: null, status: "resolved_paid", cents: 1500, count: 1, urgent: 0, awaiting: 0, unverified: 0 },
  ],
  recoveries: [],
  ...over,
});

describe("buildMoneyFlow (pure)", () => {
  it("conserves every middle node and sums the at-risk states to the exposure", () => {
    const f = buildMoneyFlow(base());
    expectConserved(f);
    expect(f.startsAt).toBe("ledger");
    expect(f.exposure).toEqual({ cents: 4500, count: 3 });
    const states = f.nodes.filter((n) => n.kind === "state");
    expect(states.reduce((a, n) => a + n.cents, 0)).toBe(f.exposure.cents);
    expect(f.byState.map((s) => [s.state, s.cents])).toEqual([
      ["CA", 3000],
      ["TX", 1500],
    ]);
    // The ledger node is the sum of what flows out of it.
    expect(f.nodes.find((n) => n.id === "ledger")?.cents).toBe(9000 + 500 + 6000);
  });

  it("drops zero links and nodes nobody links to", () => {
    const f = buildMoneyFlow(base({ ledger: { stale: { cents: 6000, count: 4 }, notStale: zero, cleared: { cents: 9000, count: 3 } } }));
    expect(f.links.every((l) => l.cents > 0 && l.count > 0)).toBe(true);
    expect(f.nodes.find((n) => n.id === "not_stale")).toBeUndefined();
    expect(f.nodes.find((n) => n.id === "needs_rule")).toBeUndefined();
  });

  it("starts at Stale when the ledger has no cleared or voided rows, and never back-fills it", () => {
    const f = buildMoneyFlow(base({ ledger: { stale: { cents: 6000, count: 4 }, notStale: zero, cleared: zero } }));
    expect(f.startsAt).toBe("stale");
    expect(f.nodes.find((n) => n.id === "ledger")).toBeUndefined();
    expect(f.nodes.find((n) => n.id === "stale")?.column).toBe(0);
    expectConserved(f);
  });

  it("marks links pink only where a person is needed (deadline within 7 days, or a letter awaiting approval)", () => {
    const f = buildMoneyFlow(base());
    expect(f.links.find((l) => l.source === "state:CA" && l.target === "to_report")?.tone).toBe("human");
    expect(f.links.find((l) => l.source === "state:TX" && l.target === "dd")?.tone).toBe("human");
    expect(f.links.find((l) => l.source === "state:CA" && l.target === "watching")?.tone).toBe("default");
    expect(f.nodes.find((n) => n.id === "to_report")?.needsYou).toBe(true);
  });

  it("recovered is absent with no paid recoveries, and is exactly the paid rows when they exist", () => {
    expect(buildMoneyFlow(base()).recovered).toBeNull();
    const withClaims = buildMoneyFlow(base({ recoveries: [{ state: "TX", status: "found", cents: 700, count: 1 }] }));
    expect(withClaims.recovered).toBeNull();
    expect(withClaims.claimsInProgress).toEqual({ cents: 700, count: 1 });
    const paid = buildMoneyFlow(
      base({
        recoveries: [
          { state: "TX", status: "paid", cents: 1200, count: 2 },
          { state: "CA", status: "paid", cents: 300, count: 1 },
          { state: "CA", status: "rejected", cents: 999, count: 1 },
        ],
      }),
    );
    expect(paid.recovered).toEqual({ cents: 1500, count: 3 });
    expect(paid.recoveredByState).toEqual([
      { state: "TX", cents: 1200, count: 2 },
      { state: "CA", cents: 300, count: 1 },
    ]);
    expect(paid.links.filter((l) => l.band === "recovery").every((l) => l.tone === "recovered")).toBe(true);
  });
});

describe("getMoneyFlow (database)", () => {
  let t: TestDb;
  let companyId: string;
  const prevAnchor = process.env.DEMO_ANCHOR_DATE;
  beforeAll(() => {
    process.env.DEMO_ANCHOR_DATE = "2026-11-01";
  });
  afterAll(() => {
    if (prevAnchor === undefined) delete process.env.DEMO_ANCHOR_DATE;
    else process.env.DEMO_ANCHOR_DATE = prevAnchor;
  });
  beforeEach(async () => {
    t = await createTestDb();
    ({ companyId } = await insertFixture(t.db, STANDARD_ITEMS));
  });
  afterEach(async () => {
    await t.close();
  });

  it("reconciles to the dashboard total and the per-state exposure", async () => {
    const [flow, exp] = await Promise.all([getMoneyFlow(t.db, companyId), getExposure(t.db, companyId)]);
    expect(flow.exposure).toEqual({ cents: exp.totalCents, count: exp.itemCount });
    expect(flow.byState.map((s) => [s.state, s.cents, s.count])).toEqual(exp.byState.map((s) => [s.state, s.cents, s.count]));
    expectConserved(flow);
    expect(flow.recovered).toBeNull();
  });

  it("includes cleared ledger rows and real paid recoveries", async () => {
    await t.db.insert(ledgerItems).values({
      companyId,
      payeeNameRaw: "CLEARED VENDOR (SYNTHETIC)",
      propertyType: "vendor_check",
      amountCents: 4321,
      issueDate: "2025-01-01",
      status: "cleared",
      source: "synthetic",
    });
    await t.db.insert(recoveries).values({ companyId, state: "TX", amountCents: 2500, status: "paid" });
    const flow = await getMoneyFlow(t.db, companyId);
    expect(flow.startsAt).toBe("ledger");
    expect(flow.links.find((l) => l.source === "ledger" && l.target === "cleared")).toMatchObject({ cents: 4321, count: 1 });
    expect(flow.recovered).toEqual({ cents: 2500, count: 1 });
    const all = await t.db.select().from(ledgerItems).where(eq(ledgerItems.companyId, companyId));
    expect(flow.nodes.find((n) => n.id === "ledger")?.count).toBe(all.length);
    expectConserved(flow);
  });
});
