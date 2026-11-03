import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/db/client";
import type { IsoDate } from "@/lib/dates";
import { nextDeadline } from "./common";
import { listStaleItems } from "./items";
import { insertFixture, type FixtureItem } from "./test-fixtures";

const TODAY = "2026-11-01" as IsoDate;
// Demo clock 2026-11-01. R3-06 (sort by the next open obligation) and R3-17 (satisfied obligations drop out).
const item = (key: string, over: Partial<FixtureItem>): FixtureItem => ({
  key,
  check: key,
  payee: `Payee ${key}`,
  cents: 10_000,
  issueDate: "2025-01-01",
  state: "TX",
  status: "to_report",
  ...over,
});

const ITEMS: FixtureItem[] = [
  // Next obligation is tomorrow, but a long-past DD window start must not matter.
  item("SOON", { status: "dd_pending", ddStart: "2026-01-01", ddEnd: "2026-11-02" }),
  // Overdue report (strictly before today), earliest date ever is older than the others.
  item("LATE", { status: "to_report", ddStart: "2026-01-01", ddEnd: "2026-03-01", report: "2026-07-01", remit: "2026-08-01" }),
  item("TODAY", { status: "to_report", report: "2026-11-01", remit: "2027-01-01" }),
  item("FAR", { status: "to_report", report: "2027-02-23" }),
  // Reported, old report date long past, remit still in the future: only the remit counts.
  item("FILED", { status: "reported", ddStart: "2026-01-01", ddEnd: "2026-02-01", report: "2026-02-02", remit: "2027-06-15" }),
  item("NODATES", { status: "needs_rule" }),
];

let t: TestDb;
let companyId: string;
const prev = process.env.DEMO_ANCHOR_DATE;
beforeAll(() => {
  process.env.DEMO_ANCHOR_DATE = "2026-11-01";
});
afterAll(() => {
  if (prev === undefined) delete process.env.DEMO_ANCHOR_DATE;
  else process.env.DEMO_ANCHOR_DATE = prev;
});
beforeEach(async () => {
  t = await createTestDb();
  ({ companyId } = await insertFixture(t.db, ITEMS));
});
afterEach(async () => {
  await t.close();
});

describe("Items deadline sort (R3-06)", () => {
  it("ascending: overdue first, then the next upcoming obligation, unknown last", async () => {
    const r = await listStaleItems(t.db, companyId, { sort: "deadline_asc" });
    expect(r.items.map((i) => i.checkNumber)).toEqual(["LATE", "TODAY", "SOON", "FAR", "FILED", "NODATES"]);
  });

  it("descending: furthest next obligation first, overdue after dated items, unknown still last", async () => {
    const r = await listStaleItems(t.db, companyId, { sort: "deadline_desc" });
    expect(r.items.map((i) => i.checkNumber)).toEqual(["FILED", "FAR", "SOON", "TODAY", "LATE", "NODATES"]);
  });
});

describe("next deadline skips satisfied obligations (R3-17)", () => {
  it("a reported item's next deadline is its remittance, not the report date it already filed", async () => {
    const r = await listStaleItems(t.db, companyId, { search: "FILED" });
    expect(r.items[0]!.nextDeadline).toEqual({ kind: "remit_due", date: "2027-06-15", verified: true });
  });

  it("a reported item with no remit date left has no next deadline", () => {
    const cols = { ddWindowStart: null, ddWindowEnd: "2026-11-02", reportDueDate: "2026-11-02", remitDueDate: null };
    expect(nextDeadline(cols, TODAY, true, "reported")).toBeNull();
    expect(nextDeadline(cols, TODAY, true, "to_report")).toMatchObject({ kind: "report_due" });
  });
});
