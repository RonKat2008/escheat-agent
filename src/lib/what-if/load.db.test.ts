/**
 * The what-if loader + projection against a real (PGlite) database: it writes NOTHING (every table's row count and
 * content, the demo clock and sim_clock are identical before and after), and at offset 0 with no scenario it agrees
 * with the dashboard's exposure and audit-interest queries.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/db/client";
import { simClock } from "@/db/schema";
import { now } from "@/lib/clock";
import { getExposure } from "@/lib/queries/exposure";
import { getAuditInterestExposure } from "@/lib/queries/interest";
import { insertFixture, type FixtureItem } from "@/lib/queries/test-fixtures";
import { loadWhatIfSnapshot } from "./load";
import { project } from "./project";
import { EMPTY_SCENARIO } from "./scenario";

const ITEMS: FixtureItem[] = [
  { key: "a", check: "91001", payee: "Synthetic CA Soon", cents: 120000, issueDate: "2022-01-01", state: "CA", status: "dd_pending", unverified: true, ddStart: "2026-11-01", ddEnd: "2027-05-02", report: "2026-12-01", remit: "2027-06-15", presumed: "2026-11-20" },
  { key: "b", check: "91002", payee: "Synthetic TX Late", cents: 80000, issueDate: "2021-01-01", state: "TX", status: "to_report", unverified: true, report: "2026-07-01", remit: "2026-07-01" },
  { key: "c", check: "91003", payee: "Synthetic DE", cents: 40000, issueDate: "2022-06-01", state: "DE", status: "watching", ddStart: "2027-11-01", ddEnd: "2027-12-31", report: "2028-03-01", remit: "2028-03-01" },
  { key: "d", check: "91004", payee: "Synthetic Reported", cents: 30000, issueDate: "2021-06-01", state: "CA", status: "reported", report: "2026-06-01", remit: "2027-06-15" },
  { key: "e", check: "91005", payee: "Synthetic Paid", cents: 99999, issueDate: "2021-06-01", state: "CA", status: "resolved_paid" },
  { key: "f", check: "91006", payee: "Synthetic Nowhere", cents: 15000, issueDate: "2021-06-01", state: null, status: "needs_rule" },
];

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
  ({ companyId } = await insertFixture(t.db, ITEMS));
  await t.db.insert(simClock).values({ companyId, offsetDays: 3 });
});
afterEach(async () => {
  await t.close();
});

/** Row count and full content of every table in the public schema. */
async function dbState(): Promise<string> {
  const tables = (await t.db.execute(sql`select tablename from pg_tables where schemaname = 'public' order by tablename`)) as unknown as {
    rows: { tablename: string }[];
  };
  const out: Record<string, unknown> = {};
  for (const { tablename } of tables.rows) {
    const r = (await t.db.execute(sql.raw(`select * from "${tablename}" order by 1`))) as unknown as { rows: unknown[] };
    out[tablename] = { n: r.rows.length, rows: r.rows };
  }
  return JSON.stringify(out);
}

describe("what-if is read-only", () => {
  it("leaves every table, sim_clock and the demo clock unchanged across many projections", async () => {
    const before = await dbState();
    const clockBefore = await now(t.db, companyId);
    expect(clockBefore).toBe("2026-11-04");

    const snap = await loadWhatIfSnapshot(t.db, companyId);
    for (const offset of [0, 30, 365, 730]) {
      project(snap, { offset, paid: [snap.items[0]!.id], nextReport: [], onTimeStates: ["CA", "TX"] });
      project(snap, { ...EMPTY_SCENARIO, offset });
    }
    await loadWhatIfSnapshot(t.db, companyId);

    expect(await now(t.db, companyId)).toBe(clockBefore);
    expect(await dbState()).toBe(before);
  });
});

describe("offset 0 agrees with the dashboard queries", () => {
  it("exposure (open, unfiled) and per-state audit interest match exactly", async () => {
    const snap = await loadWhatIfSnapshot(t.db, companyId);
    expect(snap.today).toBe("2026-11-04");
    expect(snap.items.map((i) => i.checkNumber).sort()).toEqual(["91001", "91002", "91003", "91004", "91006"]);
    const p = project(snap, EMPTY_SCENARIO);

    const exposure = await getExposure(t.db, companyId);
    expect(p.exposure.cents).toBe(exposure.totalCents);
    expect(p.exposure.byState.map((s) => [s.state, s.cents, s.count])).toEqual(exposure.byState.map((s) => [s.state, s.cents, s.count]));

    const interest = await getAuditInterestExposure(t.db, companyId);
    expect(p.interest.byState.map((s) => [s.state, s.status, s.cents, s.verified])).toEqual(
      interest.byState.map((s) => [s.state, s.status, s.interest?.cents ?? null, s.verified]),
    );
    expect(p.interest.cents).toBe(interest.totalCents);
  });
});
