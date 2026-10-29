import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/db/client";
import { eq } from "drizzle-orm";
import { agentRuns, evalCases, evalResults, evalRuns, outreach, staleItems } from "@/db/schema";
import { advanceClock } from "@/lib/clock";
import {
  explainItem,
  findStaleItemId,
  getAuditInterestExposure,
  getCompany,
  getDefaultCompanyId,
  getExposure,
  getFeaturedItem,
  getLatestEvalRun,
  getStatusCounts,
  listAgentRuns,
  listStaleItems,
  upcomingDeadlines,
} from "./index";
import { insertFixture, STANDARD_ITEMS } from "./test-fixtures";

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

describe("company helpers", () => {
  it("default company is the single seeded holder", async () => {
    expect(await getDefaultCompanyId(t.db)).toBe(companyId);
    expect((await getCompany(t.db)).name).toContain("Test Holder");
  });
  it("throws a helpful error when nothing is seeded", async () => {
    const empty = await createTestDb();
    await expect(getDefaultCompanyId(empty.db)).rejects.toThrow(/seed:demo/);
    await empty.close();
  });
});

describe("getExposure", () => {
  it("totals open items exactly and excludes resolved_paid and remitted", async () => {
    const e = await getExposure(t.db, companyId);
    expect(e.asOf).toBe("2026-11-01");
    expect(e.totalCents).toBe(234000 + 50000 + 25050 + 1000);
    expect(e.total.formatted).toBe("$3,100.50");
    expect(e.itemCount).toBe(4);
  });
  it("splits by state with exact cents, counts and unverified flags", async () => {
    const e = await getExposure(t.db, companyId);
    const by = Object.fromEntries(e.byState.map((s) => [s.state, s]));
    expect(by.CA).toMatchObject({ cents: 234000, count: 1, anyUnverified: false });
    expect(by.TX).toMatchObject({ cents: 50000, count: 1, anyUnverified: true });
    expect(by.DE).toMatchObject({ cents: 25050, count: 1 });
    expect(by.UNKNOWN).toMatchObject({ cents: 1000, count: 1, anyUnverified: true });
    expect(e.anyUnverified).toBe(true);
    expect(e.byState[0]!.state).toBe("CA"); // sorted by cents desc
  });
  it("groups by status and property type", async () => {
    const e = await getExposure(t.db, companyId);
    expect(e.byStatus.map((s) => s.status).sort()).toEqual(["dd_pending", "dd_sent", "needs_rule", "watching"]);
    expect(e.byPropertyType.find((p) => p.propertyType === "customer_credit")?.cents).toBe(25050);
  });
  it("filters by state (case-insensitive)", async () => {
    const e = await getExposure(t.db, companyId, { state: "tx" });
    expect(e.totalCents).toBe(50000);
    expect(e.byState).toHaveLength(1);
  });
  it("moves an item out of exposure when it is remitted", async () => {
    await t.db.update(staleItems).set({ status: "remitted" }).where(eq(staleItems.id, ids.a!.staleId));
    expect((await getExposure(t.db, companyId)).totalCents).toBe(50000 + 25050 + 1000);
  });
});

describe("listStaleItems", () => {
  it("returns rows with payee, check number, age vs the demo clock, and next deadline", async () => {
    const r = await listStaleItems(t.db, companyId, { search: "10482" });
    expect(r.total).toBe(1);
    const row = r.items[0]!;
    expect(row).toMatchObject({ payeeName: "Bayline Electric", checkNumber: "10482", ownerState: "CA", ageDays: 426 });
    expect(row.amount).toEqual({ cents: 234000, formatted: "$2,340.00" });
    expect(row.nextDeadline).toEqual({ kind: "dd_window_start", date: "2026-11-01", verified: true });
  });
  it("hides closed items by default and includes them on request", async () => {
    expect((await listStaleItems(t.db, companyId)).total).toBe(4);
    expect((await listStaleItems(t.db, companyId, { includeClosed: true })).total).toBe(6);
  });
  it("filters by state, status, property type, age and review flag", async () => {
    expect((await listStaleItems(t.db, companyId, { state: "DE" })).items.map((i) => i.checkNumber)).toEqual(["30001"]);
    expect((await listStaleItems(t.db, companyId, { status: "dd_pending" })).total).toBe(1);
    expect((await listStaleItems(t.db, companyId, { propertyType: "customer_credit" })).total).toBe(1);
    // ages at 2026-11-01: 10482=426d, 20001=655d, 30001=700d, 60001=638d
    expect((await listStaleItems(t.db, companyId, { minAgeDays: 650 })).items.map((i) => i.checkNumber).sort()).toEqual(["20001", "30001"]);
    expect((await listStaleItems(t.db, companyId, { maxAgeDays: 426 })).items.map((i) => i.checkNumber)).toEqual(["10482"]);
    expect((await listStaleItems(t.db, companyId, { needsReview: true })).items.map((i) => i.checkNumber)).toEqual(["60001"]);
  });
  it("sorts, pages and searches by payee", async () => {
    const byAmount = await listStaleItems(t.db, companyId, { sort: "amount_desc", limit: 2 });
    expect(byAmount.items.map((i) => i.checkNumber)).toEqual(["10482", "20001"]);
    expect(byAmount.total).toBe(4);
    const page2 = await listStaleItems(t.db, companyId, { sort: "amount_desc", limit: 2, offset: 2 });
    expect(page2.items.map((i) => i.checkNumber)).toEqual(["30001", "60001"]);
    expect((await listStaleItems(t.db, companyId, { search: "lone star" })).total).toBe(1);
    expect((await listStaleItems(t.db, companyId, { search: "%" })).total).toBe(0);
  });
  it("age follows the sim clock", async () => {
    await advanceClock(t.db, companyId, 10);
    const row = (await listStaleItems(t.db, companyId, { search: "10482" })).items[0]!;
    expect(row.ageDays).toBe(436);
  });
});

describe("upcomingDeadlines window boundaries", () => {
  it("includes today and today+N, excludes yesterday and N+1, skips closed items", async () => {
    const { events, asOf } = await upcomingDeadlines(t.db, companyId, 30);
    expect(asOf).toBe("2026-11-01");
    const key = events.map((e) => `${e.date} ${e.kind} ${e.checkNumber}`);
    expect(key).toContain("2026-11-01 dd_window_start 10482"); // today: included
    expect(key).toContain("2026-12-01 dd_window_end 10482"); // today+30: included
    expect(key).not.toContain("2026-10-31 dd_window_start 20001"); // yesterday
    expect(key).not.toContain("2026-12-02 dd_window_end 20001"); // today+31
    expect(key.some((k) => k.endsWith("40001") || k.endsWith("50001"))).toBe(false); // closed
    expect(key).toContain("2026-11-15 dd_window_end 30001");
  });
  it("is sorted and carries verified flags and daysUntil", async () => {
    const { events } = await upcomingDeadlines(t.db, companyId, 400);
    const dates = events.map((e) => e.date);
    expect(dates).toEqual([...dates].sort());
    const e = events.find((x) => x.checkNumber === "10482" && x.kind === "dd_window_start")!;
    expect(e.daysUntil).toBe(0);
    expect(e.verified).toBe(true);
    expect(events.find((x) => x.checkNumber === "20001")!.verified).toBe(false);
  });
});

describe("explainItem", () => {
  it("resolves by check number, includes rule sources and unverified flags", async () => {
    const sid = await findStaleItemId(t.db, companyId, "#10482");
    expect(sid).toBe(ids.a!.staleId);
    expect(await findStaleItemId(t.db, companyId, ids.a!.staleId)).toBe(sid);
    expect(await findStaleItemId(t.db, companyId, "nope")).toBeNull();
    const e = (await explainItem(t.db, sid!))!;
    expect(e.item).toMatchObject({ checkNumber: "10482", payeeName: "Bayline Electric" });
    expect(e.rules).toMatchObject({ state: "CA", loaded: true });
    expect(e.timeline.map((x) => x.key)).toEqual(["presumed_abandoned", "dd_window_start", "dd_window_end", "report_due", "remit_due"]);
    const abandoned = e.timeline.find((x) => x.key === "presumed_abandoned")!;
    expect(abandoned.status).toBe("ok");
    expect(abandoned.date).not.toBeNull();
    expect(abandoned.verified).toBe(false); // shipped rule files are all unverified
    expect(abandoned.rulePaths.length).toBeGreaterThan(0);
    expect(abandoned.ruleVersion).toBeTruthy();
    expect(abandoned.sources.length).toBeGreaterThan(0);
    expect(abandoned.sources[0]!.url).toMatch(/^https?:\/\//);
    expect(e.payee?.canonicalName).toBe("Bayline Electric");
  });
  it("reports unknown (never a guess) when the owner state is unknown", async () => {
    const e = (await explainItem(t.db, ids.f!.staleId))!;
    expect(e.rules.loaded).toBe(false);
    expect(e.timeline.every((x) => x.status === "unknown" && x.date === null && !x.verified)).toBe(true);
  });
  it("includes outreach, agent runs, and returns null for a missing id", async () => {
    await t.db.insert(outreach).values({ companyId, staleItemId: ids.a!.staleId, channel: "letter", status: "draft" });
    await t.db.insert(agentRuns).values({ companyId, staleItemId: ids.a!.staleId, agent: "classifier", status: "succeeded" });
    const e = (await explainItem(t.db, ids.a!.staleId))!;
    expect(e.outreach).toHaveLength(1);
    expect(e.agentRuns[0]!.agent).toBe("classifier");
    expect(await explainItem(t.db, "00000000-0000-4000-8000-000000000000")).toBeNull();
  });
});

describe("getAuditInterestExposure", () => {
  it("propagates unknown when an item has no report due date and when owner state is unknown", async () => {
    const r = await getAuditInterestExposure(t.db, companyId);
    expect(r.anyUnknown).toBe(true);
    expect(r.totalCents).toBeNull();
    expect(r.total).toBeNull();
    expect(r.label).toBe("Estimate; rule unverified");
    const by = Object.fromEntries(r.byState.map((s) => [s.state, s]));
    expect(by.UNKNOWN!.status).toBe("unknown");
    expect(by.DE!.status).toBe("unknown"); // no report due date on the DE fixture
    expect(by.CA!.label).toBe("Estimate; rule unverified");
  });
  it("computes a state estimate from the rules engine when due dates are known", async () => {
    // CA item (report due 2027-06-30) is in the future => 0 days of interest; TX item overdue after advancing the clock.
    await advanceClock(t.db, companyId, 400); // 2027-12-06
    const r = await getAuditInterestExposure(t.db, companyId);
    const ca = r.byState.find((s) => s.state === "CA")!;
    expect(ca.status).toBe("ok");
    expect(ca.interest!.cents).toBeGreaterThan(0);
    expect(ca.verified).toBe(false);
    expect(ca.sources.length).toBeGreaterThan(0);
    expect(r.totalCents).toBeNull(); // still unknown elsewhere
  });
});

describe("misc read models", () => {
  it("featured item and status counts", async () => {
    expect((await getFeaturedItem(t.db, companyId))?.checkNumber).toBe("10482");
    const sc = await getStatusCounts(t.db, companyId);
    expect(sc.find((s) => s.status === "resolved_paid")).toMatchObject({ count: 1, open: false });
    expect(sc.find((s) => s.status === "watching")).toMatchObject({ count: 1, open: true, cents: 234000 });
  });
  it("agent runs and latest eval run", async () => {
    await t.db.insert(agentRuns).values({ companyId, agent: "classifier", status: "succeeded" });
    expect(await listAgentRuns(t.db, companyId)).toHaveLength(1);
    expect(await getLatestEvalRun(t.db)).toBeNull();
    const [c] = await t.db.insert(evalCases).values({ slice: "generated", itemSnapshot: {}, expected: {} }).returning();
    const [run] = await t.db.insert(evalRuns).values({ workerModel: "w", orchestratorModel: "o" }).returning();
    await t.db.insert(evalResults).values({ runId: run!.id, caseId: c!.id, pass: true });
    const latest = await getLatestEvalRun(t.db);
    expect(latest?.results).toHaveLength(1);
    expect(latest?.results[0]).toMatchObject({ pass: true, slice: "generated" });
  });
});
