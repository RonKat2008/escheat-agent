/**
 * R5-08 / R5-07 / R5-14 (dogfood round 5, opportunity #5 "one set of numbers everywhere"): the dashboard headline,
 * Items, the Money Map, the Money Flow (Sankey), its Late band and the Items "Needs action" view are read from the same
 * definitions, so they reconcile on any demo date. This is the same wiring loadDashboard uses.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/db/client";
import { advanceClock } from "@/lib/clock";
import { summarizeLateMoney } from "@/lib/reports/late-money";
import { tryLoadRules } from "@/lib/rules/load";
import { getExposure, getOpenCounts, getOverdue, listStaleItems } from "./index";
import { getMoneyFlow, lateRows, pinkCaptionText } from "./flow";
import { getNeedsActionIds } from "./needs-action";
import { insertFixture, STANDARD_ITEMS, type FixtureItem } from "./test-fixtures";

/** Anchor 2026-11-01. g: report due tomorrow (its DD window closed long ago). h: reported, remit due 2027-03-01. i: report missed. */
const ITEMS: FixtureItem[] = [
  ...STANDARD_ITEMS,
  { key: "g", check: "70001", payee: "Callum Whitlock", cents: 157410, issueDate: "2023-03-01", state: "TX", status: "to_report", ddStart: "2026-03-01", ddEnd: "2026-06-01", report: "2026-11-02", remit: "2026-11-02" },
  { key: "h", check: "70002", payee: "Moonrake Partners", cents: 234784, issueDate: "2022-05-01", state: "CA", status: "reported", report: "2026-10-31", remit: "2027-03-01" },
  { key: "i", check: "70003", payee: "Rushmere Freight", cents: 92431, issueDate: "2022-01-01", state: "TX", status: "to_report", ddEnd: "2026-05-01", report: "2026-07-01", remit: "2026-07-01" },
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
});
afterEach(async () => {
  await t.close();
});

/** The dashboard's wiring (src/app/(app)/dashboard/data.ts loadDashboard), without React. */
async function dashboard() {
  const overdue = await getOverdue(t.db, companyId);
  const lateMoney = summarizeLateMoney(overdue.items, (s) => tryLoadRules(s)?.file ?? null, overdue.asOf);
  const flow = await getMoneyFlow(t.db, companyId, {
    late: lateRows(overdue.items),
    lateInterest: { cents: lateMoney.interestCents, verified: lateMoney.interestVerified, unknownStates: lateMoney.unknownInterestStates },
  });
  const [openCounts, exposure, items] = await Promise.all([
    getOpenCounts(t.db, companyId),
    getExposure(t.db, companyId),
    listStaleItems(t.db, companyId, { limit: 500 }),
  ]);
  return { overdue, lateMoney, flow, openCounts, exposure, items };
}

describe.each([0, 30, 180, 365])("one set of numbers at clock +%i days", (offset) => {
  it("headline count and dollars measure the same set, and Items and the Money Flow agree with it", async () => {
    if (offset) await advanceClock(t.db, companyId, offset);
    const d = await dashboard();
    const unreportedRows = d.items.items.filter((r) => r.status !== "reported");
    const reportedRows = d.items.items.filter((r) => r.status === "reported");
    const sum = (rows: { amount: { cents: number } }[]) => rows.reduce((a, r) => a + r.amount.cents, 0);

    // Headline: "$X · N stale items not yet reported" is one set (R5-08).
    expect(d.openCounts.unreported).toEqual({ count: d.exposure.itemCount, cents: d.exposure.totalCents });
    // Items: the same split in its total row.
    expect(unreportedRows.length).toBe(d.openCounts.unreported.count);
    expect(sum(unreportedRows)).toBe(d.openCounts.unreported.cents);
    expect({ count: reportedRows.length, cents: sum(reportedRows) }).toEqual(d.openCounts.reported);
    expect(d.items.total).toBe(d.openCounts.open.count);
    // Money Flow "At risk" states and the Money Map columns.
    expect(d.flow.exposure).toEqual({ count: d.openCounts.unreported.count, cents: d.openCounts.unreported.cents });
    const atRisk = d.flow.nodes.filter((n) => n.kind === "state");
    expect(atRisk.reduce((a, n) => a + n.cents, 0)).toBe(d.openCounts.unreported.cents);
    expect(d.flow.byState.map((s) => [s.state, s.cents, s.count])).toEqual(d.exposure.byState.map((s) => [s.state, s.cents, s.count]));
    // The Late band is exactly the Overdue panel's items (R5-07): same count, dollars and interest.
    const lateNode = d.flow.nodes.find((n) => n.id === "late");
    if (d.overdue.count === 0) {
      expect(d.flow.late).toBeNull();
    } else {
      expect({ count: d.flow.late!.count, cents: d.flow.late!.cents }).toEqual({ count: d.overdue.count, cents: d.overdue.total.cents });
      expect({ count: lateNode!.count, cents: lateNode!.cents }).toEqual({ count: d.overdue.count, cents: d.overdue.total.cents });
      expect(d.lateMoney.lateCents).toBe(d.flow.late!.cents);
      expect(d.flow.late!.interest?.cents ?? null).toBe(d.lateMoney.interestCents);
    }
    // Needs action counts every overdue item (R5-14).
    const needs = await getNeedsActionIds(t.db, companyId);
    for (const o of d.overdue.items) expect(needs.has(o.itemId), `overdue ${o.payeeName} needs action`).toBe(true);
  });
});

describe("R5-07: pink follows the caption's rule", () => {
  it("Ready to report due tomorrow is pink even though its DD window closed long ago", async () => {
    const { flow } = await dashboard();
    const ready = flow.links.find((l) => l.source === "state:TX" && l.target === "to_report");
    expect(ready?.tone).toBe("human");
    expect(flow.nodes.find((n) => n.id === "to_report")?.needsYou).toBe(true);
    expect(flow.byState.find((s) => s.state === "TX")?.urgent).toBeGreaterThan(0);
    expect(pinkCaptionText(flow)).toMatch(/Late is past .*; the other pink bands have a deadline within 7 days/);
  });

  it("at +1y the Late band holds the remit-late reported item with only its own items' interest", async () => {
    await advanceClock(t.db, companyId, 365);
    const { flow, overdue, lateMoney } = await dashboard();
    expect(overdue.items.map((i) => i.itemId)).toContain(ids.h!.staleId);
    expect(flow.late!.remitLate).toEqual({ count: 1, cents: 234784 });
    const remitBand = flow.links.find((l) => l.source === "reported" && l.target === "late");
    expect(remitBand).toMatchObject({ cents: 234784, count: 1, tone: "late", href: "/items?status=reported&overdue=1" });
    // Every interest-bearing item is inside the band, so the band's interest is the panel's interest, not more.
    const inBand = new Set(overdue.items.map((i) => i.itemId));
    expect(lateMoney.byState.reduce((a, s) => a + s.count, 0)).toBe(inBand.size);
    expect(flow.late!.count).toBe(inBand.size);
  });

  it("the caption names only the bands that are drawn", () => {
    expect(pinkCaptionText({ links: [] })).toBe("Nothing needs a person right now, so no band is pink.");
    const link = (tone: "late" | "human") => ({ source: "a", target: "b", cents: 1, count: 1, band: "main" as const, tone, href: "/items", alsoListed: 0 });
    expect(pinkCaptionText({ links: [link("human")] })).toBe("Pink needs a person: those bands have a deadline within 7 days or a letter awaiting approval.");
    expect(pinkCaptionText({ links: [link("late")] })).not.toMatch(/other/);
  });
});
