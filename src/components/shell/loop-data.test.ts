import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/db/client";
import { agentRuns, companies, outreach, reports } from "@/db/schema";
import { insertFixture, STANDARD_ITEMS, type FixtureItem } from "@/lib/queries/test-fixtures";
import { getLoopData } from "./loop-data";

const URGENT_ITEM: FixtureItem = {
  key: "g",
  check: "70001",
  payee: "Gate Soon Corp",
  cents: 12000,
  issueDate: "2025-03-01",
  state: "TX",
  status: "dd_pending",
  ddStart: "2026-10-20",
  ddEnd: "2026-11-04",
};

let t: TestDb;
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
});
afterEach(async () => {
  await t.close();
});

describe("getLoopData (Loop Bar counts)", () => {
  it("counts each stage from real rows", async () => {
    const { companyId } = await insertFixture(t.db, [...STANDARD_ITEMS, URGENT_ITEM]);
    const d = await getLoopData(t.db, companyId);
    expect(d.asOf).toBe("2026-11-01");
    // triage: b (dd_pending), f (needs_rule), g (dd_pending); closed d/e excluded
    // draft: a, b, g are inside an open DD window with no outreach; c has no window start
    expect(d.counts).toEqual({ triage: 3, draft: 3, approve: 0, file: 0 });
    expect(d.running).toBe(0);
    expect(d.input.unverifiedBlocking).toBe(1);
    expect(d.input.nextDeadline).toBe("2026-11-04");
    expect(d.next.kind).toBe("draft");
  });

  it("a waiting letter moves an item from Draft to Approve and flags it urgent within 7 days", async () => {
    const { companyId, ids } = await insertFixture(t.db, [...STANDARD_ITEMS, URGENT_ITEM]);
    await t.db.insert(outreach).values({ companyId, staleItemId: ids.g!.staleId, channel: "letter", status: "awaiting_approval" });
    await t.db.insert(outreach).values({ companyId, staleItemId: ids.a!.staleId, channel: "letter", status: "cancelled" });
    await t.db.insert(reports).values({ companyId, state: "TX", reportYear: 2026, status: "approved" });
    await t.db.insert(agentRuns).values({ companyId, agent: "filing", status: "running" });

    const d = await getLoopData(t.db, companyId);
    expect(d.counts).toEqual({ triage: 3, draft: 2, approve: 1, file: 1 });
    expect(d.running).toBe(1);
    expect(d.input.urgentApprovals).toBe(1);
    expect(d.input.urgentDeadline).toBe("2026-11-04");
    expect(d.next).toMatchObject({ kind: "approve_urgent", label: "Approve 1 item", detail: "due in 3 days", human: true });
  });

  it("an approval far from its deadline is not urgent", async () => {
    const { companyId, ids } = await insertFixture(t.db, STANDARD_ITEMS);
    await t.db.insert(outreach).values({ companyId, staleItemId: ids.a!.staleId, channel: "letter", status: "draft" });
    const d = await getLoopData(t.db, companyId);
    expect(d.counts.approve).toBe(1);
    expect(d.input.urgentApprovals).toBe(0);
    expect(d.next.kind).toBe("approve");
  });

  it("with no ledger rows every stage is unknown, never zero-filled", async () => {
    const [co] = await t.db.insert(companies).values({ name: "Empty Holder (SYNTHETIC)", incorporationState: "DE", hqState: "TX" }).returning();
    const d = await getLoopData(t.db, co!.id);
    expect(d.counts).toEqual({ triage: null, draft: null, approve: null, file: null });
    expect(d.next.kind).toBe("setup");
  });
});
