/**
 * Audit Drill query against a real (PGlite) database: the sample is deterministic, the bank link comes from a
 * reconciliation that is never saved, sent notices are read through outreach, and nothing is written.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/db/client";
import { approvals, bankClears, ledgerItems, outreach, reports, staleItems } from "@/db/schema";
import { loadAuditDrill } from "./audit";
import { insertFixture, type FixtureItem } from "./test-fixtures";

const ITEMS: FixtureItem[] = [
  { key: "a", check: "70001", payee: "Synthetic Alpha", cents: 150000, issueDate: "2021-02-01", state: "DE", status: "dd_pending", unverified: true, ruleVersion: "2026.10.1-draft", ddStart: "2026-10-01", ddEnd: "2026-12-31", report: "2027-03-01", remit: "2027-03-01" },
  { key: "b", check: "70002", payee: "Synthetic Beta", cents: 90000, issueDate: "2021-03-01", state: "DE", status: "dd_sent", ruleVersion: "2026.10.1-draft", ddStart: "2026-10-01", ddEnd: "2026-12-31", report: "2027-03-01", remit: "2027-03-01" },
  { key: "c", check: "70003", payee: "Synthetic Gamma", cents: 40000, issueDate: "2021-04-01", state: "DE", status: "watching", ruleVersion: "2026.10.1-draft", ddStart: "2027-10-01", ddEnd: "2027-12-31", report: "2028-03-01", remit: "2028-03-01" },
  { key: "x", check: "80001", payee: "Synthetic Texan", cents: 30000, issueDate: "2021-04-01", state: "TX", status: "watching" },
];

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
  ({ companyId, ids } = await insertFixture(t.db, ITEMS));
  // Gamma's check cleared the bank: the chain must say so, and the drill must not save the match.
  await t.db.insert(bankClears).values({ companyId, referenceNumber: "70003", amountCents: 40000, clearedDate: "2021-05-01", source: "synthetic" });
  await t.db.insert(outreach).values({ companyId, staleItemId: ids.b!.staleId, channel: "letter", status: "sent", sentAt: new Date("2026-10-20T12:00:00Z") });
});
afterEach(async () => {
  await t.close();
});

async function snapshot() {
  const [l, c, s, o, r, a] = await Promise.all([
    t.db.select().from(ledgerItems),
    t.db.select().from(bankClears),
    t.db.select().from(staleItems),
    t.db.select().from(outreach),
    t.db.select().from(reports),
    t.db.select().from(approvals),
  ]);
  return JSON.stringify([l, c, s, o, r, a]);
}

describe("loadAuditDrill", () => {
  it("draws the state's items only, deterministically, capped at the population", async () => {
    const a = await loadAuditDrill(t.db, companyId, { state: "DE", size: 25 });
    const b = await loadAuditDrill(t.db, companyId, { state: "DE", size: 25 });
    expect(a.populationCount).toBe(3);
    expect(a.items).toHaveLength(3);
    expect(a.items.map((i) => i.id)).toEqual(b.items.map((i) => i.id));
    expect(a.seed).toBe(b.seed);
    expect(a.today).toBe("2026-11-01");
    expect(a.items.every((i) => i.chain.length === 9)).toBe(true);
  });

  it("builds each chain from the records, and writes nothing", async () => {
    const before = await snapshot();
    const drill = await loadAuditDrill(t.db, companyId, { state: "DE", size: 5, all: true });
    expect(await snapshot()).toBe(before);

    const link = (key: string, kind: string) => drill.items.find((i) => i.id === ids[key]!.staleId)!.chain.find((l) => l.kind === kind)!;
    expect(link("a", "rule").status).toBe("missing");
    expect(link("a", "rule").fix?.href).toBe("/rules?state=DE");
    expect(link("a", "dd_letter").status).toBe("missing");
    expect(link("b", "rule").status).toBe("proven");
    expect(link("b", "rule").sources.length).toBeGreaterThan(0);
    expect(link("b", "dd_letter").status).toBe("proven");
    expect(link("b", "owner_response").status).toBe("not_yet_due");
    expect(link("c", "bank").status).toBe("missing");
    expect(link("c", "dd_letter").status).toBe("not_yet_due");
    expect(link("a", "bank").status).toBe("proven");
    expect(drill.score.pct).toBeLessThan(100);
  });
});
