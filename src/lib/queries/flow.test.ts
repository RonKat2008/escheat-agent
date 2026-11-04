import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/db/client";
import { ledgerItems, outreach, outreachItems, recoveries } from "@/db/schema";
import type { IsoDate } from "@/lib/dates";
import { buildMoneyFlow, getMoneyFlow, itemsHref, lateRows, type FlowInput, type MoneyFlow } from "./flow";
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
  it("starts at Stale, conserves every middle node and sums the at-risk states to the exposure", () => {
    const f = buildMoneyFlow(base());
    expectConserved(f);
    expect(f.nodes[0]).toMatchObject({ id: "stale", column: 0 });
    expect(f.nodes.find((n) => n.id === "ledger")).toBeUndefined();
    expect(f.exposure).toEqual({ cents: 4500, count: 3 });
    const states = f.nodes.filter((n) => n.kind === "state");
    expect(states.reduce((a, n) => a + n.cents, 0)).toBe(f.exposure.cents);
    expect(f.byState.map((s) => [s.state, s.cents])).toEqual([
      ["CA", 3000],
      ["TX", 1500],
    ]);
    // The ledger split is a caption, not a node.
    expect(f.ledger).toMatchObject({ known: true, total: { cents: 15500, count: 8 }, cleared: { cents: 9000, count: 3 } });
  });

  it("drops zero links and nodes nobody links to", () => {
    const f = buildMoneyFlow(base());
    expect(f.links.every((l) => l.cents > 0 && l.count > 0)).toBe(true);
    expect(f.nodes.find((n) => n.id === "needs_rule")).toBeUndefined();
    expect(f.nodes.find((n) => n.id === "late")).toBeUndefined();
    expect(f.late).toBeNull();
  });

  it("marks the ledger unknown when no cleared or voided rows were imported", () => {
    const f = buildMoneyFlow(base({ ledger: { stale: { cents: 6000, count: 4 }, notStale: zero, cleared: zero } }));
    expect(f.ledger.known).toBe(false);
    expectConserved(f);
  });

  it("marks links pink only where a person is needed (deadline within 7 days, or a letter awaiting approval)", () => {
    const f = buildMoneyFlow(base());
    expect(f.links.find((l) => l.source === "state:CA" && l.target === "to_report")?.tone).toBe("human");
    expect(f.links.find((l) => l.source === "state:TX" && l.target === "dd")?.tone).toBe("human");
    expect(f.links.find((l) => l.source === "state:CA" && l.target === "watching")?.tone).toBe("default");
    expect(f.nodes.find((n) => n.id === "to_report")?.needsYou).toBe(true);
  });

  it("carves overdue items into a pink Late band, keeps conservation, and carries the interest", () => {
    const interest = { cents: 2607, verified: false, unknownStates: [] };
    const f = buildMoneyFlow(
      base({
        stale: [
          { state: "TX", status: "to_report", cents: 5000, count: 3, urgent: 0, awaiting: 0, unverified: 3 },
          { state: "CA", status: "watching", cents: 1000, count: 1, urgent: 0, awaiting: 0, unverified: 0 },
        ],
        late: [{ state: "TX", status: "to_report", cents: 3000, count: 2 }],
        lateInterest: interest,
      }),
    );
    expectConserved(f);
    const lateLink = f.links.find((l) => l.source === "state:TX" && l.target === "late")!;
    expect(lateLink).toMatchObject({ cents: 3000, count: 2, tone: "late", href: "/items?state=TX&overdue=1", alsoListed: 0 });
    const onTime = f.links.find((l) => l.source === "state:TX" && l.target === "to_report")!;
    expect(onTime).toMatchObject({ cents: 2000, count: 1, href: "/items?state=TX&status=to_report", alsoListed: 2 });
    expect(f.late).toEqual({ cents: 3000, count: 2, remitLate: { cents: 0, count: 0 }, interest });
    expect(f.nodes.find((n) => n.id === "late")).toMatchObject({ needsYou: true, column: 2, href: "/items?overdue=1" });
    // Late sits at the top of the status column.
    expect(f.nodes.filter((n) => n.column === 2)[0]?.id).toBe("late");
    expect(f.byState.find((s) => s.state === "TX")).toMatchObject({ cents: 5000, count: 3, late: 2 });
    // The state total is unchanged by the carve-out.
    expect(f.exposure).toEqual({ cents: 6000, count: 4 });
  });

  it("an entirely late status band leaves no empty on-time link", () => {
    const f = buildMoneyFlow(
      base({
        stale: [{ state: "TX", status: "to_report", cents: 700, count: 1, urgent: 0, awaiting: 0, unverified: 0 }],
        late: [{ state: "TX", status: "to_report", cents: 700, count: 1 }],
      }),
    );
    expect(f.links.find((l) => l.target === "to_report")).toBeUndefined();
    expect(f.nodes.find((n) => n.id === "to_report")).toBeUndefined();
    expectConserved(f);
  });

  it("deep-links each band to the Items filter that lists it", () => {
    const f = buildMoneyFlow(
      base({
        stale: [
          { state: "TX", status: "dd_pending", cents: 100, count: 1, urgent: 0, awaiting: 0, unverified: 0 },
          { state: "TX", status: "dd_sent", cents: 100, count: 1, urgent: 0, awaiting: 0, unverified: 0 },
          { state: "CA", status: "dd_sent", cents: 100, count: 1, urgent: 0, awaiting: 0, unverified: 0 },
          { state: null, status: "watching", cents: 100, count: 1, urgent: 0, awaiting: 0, unverified: 0 },
          { state: "DE", status: "reported", cents: 100, count: 1, urgent: 0, awaiting: 0, unverified: 0 },
        ],
      }),
    );
    const href = (s: string, t: string) => f.links.find((l) => l.source === s && l.target === t)?.href;
    expect(href("stale", "state:TX")).toBe("/items?state=TX");
    expect(href("state:TX", "dd")).toBe("/items?state=TX"); // two statuses: the state is the closest exact filter
    expect(href("state:CA", "dd")).toBe("/items?state=CA&status=dd_sent");
    expect(href("state:UNKNOWN", "watching")).toBe("/items?status=watching");
    expect(href("stale", "reported")).toBe("/items?status=reported");
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

describe("helpers", () => {
  it("itemsHref only emits filters /items parses", () => {
    expect(itemsHref({})).toBe("/items");
    expect(itemsHref({ state: "UNKNOWN", overdue: true })).toBe("/items?overdue=1");
    expect(itemsHref({ state: "TX", status: "to_report" })).toBe("/items?state=TX&status=to_report");
  });

  it("lateRows groups overdue items by state and status", () => {
    expect(
      lateRows([
        { state: "TX", status: "to_report", amount: { cents: 100 } },
        { state: "TX", status: "to_report", amount: { cents: 50 } },
        { state: null, status: "watching", amount: { cents: 7 } },
      ]),
    ).toEqual([
      { state: "TX", status: "to_report", cents: 150, count: 2 },
      { state: null, status: "watching", cents: 7, count: 1 },
    ]);
  });
});

describe("getMoneyFlow (database)", () => {
  let t: TestDb;
  let companyId: string;
  let ids: Awaited<ReturnType<typeof insertFixture>>["ids"];
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
    ({ companyId, ids } = await insertFixture(t.db, STANDARD_ITEMS));
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

  it("reports cleared ledger rows in the caption split and real paid recoveries", async () => {
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
    expect(flow.ledger.known).toBe(true);
    expect(flow.ledger.cleared).toEqual({ cents: 4321, count: 1 });
    expect(flow.recovered).toEqual({ cents: 2500, count: 1 });
    const all = await t.db.select().from(ledgerItems).where(eq(ledgerItems.companyId, companyId));
    expect(flow.ledger.total.count).toBe(all.length);
    expectConserved(flow);
  });

  it("R4-08: a draft letter that covers an item through outreach_items makes its due-diligence band pink", async () => {
    const before = await getMoneyFlow(t.db, companyId);
    expect(before.links.find((l) => l.source === "state:TX" && l.target === "dd")?.tone).toBe("default");
    // One notice per owner: the letter's primary row points at another item; TX's item rides on outreach_items.
    const [o] = await t.db.insert(outreach).values({ companyId, staleItemId: ids.c!.staleId, channel: "letter", status: "draft" }).returning();
    await t.db.insert(outreachItems).values({ outreachId: o!.id, staleItemId: ids.b!.staleId, amountCents: 50000, position: 1 });
    const after = await getMoneyFlow(t.db, companyId);
    expect(after.links.find((l) => l.source === "state:TX" && l.target === "dd")?.tone).toBe("human");
  });
});
