import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/db/client";
import { companies, ledgerItems, outreach, staleItems } from "@/db/schema";
import { heuristicClassify, type classifyBatch } from "@/lib/agents/classifier";
import { advanceClock } from "@/lib/clock";
import { diffDays, type IsoDate } from "@/lib/dates";
import { computeTimeline } from "@/lib/rules/engine";
import { loadRules } from "@/lib/rules/load";
import { detectStaleItems } from "./detect";
import { recomputeTimelines } from "./recompute";
import { advanceItem, waitTimeoutMs } from "./advance";
import { naupaCodeFor } from "./compute";

const ANCHOR = "2026-11-01";
let prevAnchor: string | undefined;
beforeAll(() => {
  prevAnchor = process.env.DEMO_ANCHOR_DATE;
  process.env.DEMO_ANCHOR_DATE = ANCHOR;
});
afterAll(() => {
  if (prevAnchor === undefined) delete process.env.DEMO_ANCHOR_DATE;
  else process.env.DEMO_ANCHOR_DATE = prevAnchor;
});

/** Hermetic: heuristic classifier (the labeled no-key fallback), never a network call. */
const classify: typeof classifyBatch = async (items, opts) => items.map((i) => heuristicClassify(i, opts.ctx));

let t: TestDb;
let companyId: string;
beforeEach(async () => {
  t = await createTestDb();
  const [c] = await t.db.insert(companies).values({ name: "Test Co", incorporationState: "DE" }).returning();
  companyId = c!.id;
});
afterEach(async () => {
  await t.close();
});

type Seed = { number: string; payee: string; issue: string; cents: number; addr?: string; city?: string; state?: string; zip?: string };
async function seed(items: Seed[]) {
  for (const i of items) {
    await t.db.insert(ledgerItems).values({
      companyId,
      payeeNameRaw: i.payee,
      propertyType: "vendor_check",
      referenceNumber: i.number,
      amountCents: i.cents,
      issueDate: i.issue,
      addressLine: i.addr ?? null,
      city: i.city ?? null,
      state: i.state ?? null,
      zip: i.zip ?? null,
      memo: "Invoice INV-1 services",
    });
  }
}

const CA_ITEM: Seed = { number: "10482", payee: "Bayline Electric", issue: "2025-09-01", cents: 234000, addr: "1 Main St", city: "Sacramento", state: "CA", zip: "95814" };
const DE_NOADDR: Seed = { number: "20001", payee: "Nowhere LLC", issue: "2025-03-01", cents: 50000 };
const RECENT: Seed = { number: "20002", payee: "Recent Co", issue: "2026-08-01", cents: 9900, state: "CA", city: "Fresno" };
const NY_ITEM: Seed = { number: "20003", payee: "Gotham Supply", issue: "2025-02-01", cents: 77700, city: "New York", state: "NY", zip: "10001" };

async function rows() {
  return t.db.select().from(staleItems).where(eq(staleItems.companyId, companyId));
}
const byNumber = async (n: string) => {
  const [r] = await t.db
    .select({ s: staleItems })
    .from(staleItems)
    .innerJoin(ledgerItems, eq(ledgerItems.id, staleItems.ledgerItemId))
    .where(eq(ledgerItems.referenceNumber, n));
  return r!.s;
};

describe("detectStaleItems", () => {
  it("inserts only business-stale outstanding items with engine-correct dates", async () => {
    await seed([CA_ITEM, DE_NOADDR, RECENT, NY_ITEM]);
    const s = await detectStaleItems(t.db, companyId, { classify });
    expect(s).toMatchObject({ inserted: 3, updated: 0, needsRule: 1, skippedNotStale: 1, totalCents: 234000 + 50000 + 77700 });
    expect(s.byState).toEqual({ CA: 1, DE: 1, NY: 1 });
    expect(s.ambiguous).toEqual([]);

    const ca = await byNumber("10482");
    const expected = computeTimeline(
      { propertyType: "vendor_check", lastActivityDate: "2025-09-01" as IsoDate, amountCents: 234000, ownerState: "CA", holderFiscalYearEnd: "12-31" },
      loadRules("CA").file,
    );
    expect(ca).toMatchObject({
      ownerState: "CA",
      ownerStateBasis: "address",
      status: "watching",
      amountCents: 234000,
      presumedAbandonedDate: expected.presumedAbandoned.date,
      ddWindowStart: expected.ddWindow.start.date,
      ddWindowEnd: expected.ddWindow.end.date,
      reportDueDate: expected.reportStages[0]!.due.date,
      remitDueDate: expected.remitDue.date,
      reportStage: expected.reportStages[0]!.name,
      ruleVersion: expected.rules.version,
      dependsOnUnverified: expected.anyUnverified,
      staleSince: "2026-03-01",
    });
    expect(ca.presumedAbandonedDate).not.toBeNull();
    const cls = ca.classification as Record<string, unknown>;
    expect(cls.property_code).toBe(naupaCodeFor("CA", "vendor_check"));
    expect(cls.method).toBe("heuristic");
    expect(cls).toHaveProperty("classification_confidence");
    expect(cls).toHaveProperty("needs_review");
    expect(cls.last_activity_date).toBe("2025-09-01");
  });

  it("DE item with no address uses incorporation basis", async () => {
    await seed([DE_NOADDR]);
    await detectStaleItems(t.db, companyId, { classify });
    const de = await byNumber("20001");
    expect(de).toMatchObject({ ownerState: "DE", ownerStateBasis: "incorporation" });
    expect(de.presumedAbandonedDate).not.toBeNull();
  });

  it("out-of-scope state becomes needs_rule with a clear reason and no invented dates", async () => {
    await seed([NY_ITEM]);
    await detectStaleItems(t.db, companyId, { classify });
    const ny = await byNumber("20003");
    expect(ny.status).toBe("needs_rule");
    expect(ny.ownerState).toBe("NY");
    expect([ny.presumedAbandonedDate, ny.ddWindowStart, ny.ddWindowEnd, ny.reportDueDate, ny.remitDueDate, ny.ruleVersion]).toEqual([null, null, null, null, null, null]);
    expect(JSON.stringify(ny.classification)).toContain("out of scope");
  });

  it("is idempotent: re-running updates rather than duplicates", async () => {
    await seed([CA_ITEM, DE_NOADDR]);
    await detectStaleItems(t.db, companyId, { classify });
    const first = await rows();
    const again = await detectStaleItems(t.db, companyId, { classify });
    expect(again).toMatchObject({ inserted: 0, updated: 2 });
    const second = await rows();
    expect(second).toHaveLength(2);
    expect(second.map((r) => r.id).sort()).toEqual(first.map((r) => r.id).sort());
    expect(second.every((r) => r.deadlineMovedAt === null)).toBe(true);
  });

  it("preserves human-driven statuses on re-run", async () => {
    await seed([CA_ITEM, DE_NOADDR, { ...CA_ITEM, number: "30001", payee: "Other" }, { ...CA_ITEM, number: "30002", payee: "Third" }]);
    await detectStaleItems(t.db, companyId, { classify });
    const set = async (n: string, status: "dd_sent" | "owner_responded" | "reported" | "resolved_paid") =>
      t.db.update(staleItems).set({ status }).where(eq(staleItems.id, (await byNumber(n)).id));
    await set("10482", "dd_sent");
    await set("20001", "owner_responded");
    await set("30001", "reported");
    await set("30002", "resolved_paid");
    await detectStaleItems(t.db, companyId, { classify });
    expect((await byNumber("10482")).status).toBe("dd_sent");
    expect((await byNumber("20001")).status).toBe("owner_responded");
    expect((await byNumber("30001")).status).toBe("reported");
    expect((await byNumber("30002")).status).toBe("resolved_paid");
  });

  it("does not insert items cleared at the bank", async () => {
    await seed([CA_ITEM]);
    const { bankClears } = await import("@/db/schema");
    await t.db.insert(bankClears).values({ companyId, referenceNumber: "10482", amountCents: 234000, clearedDate: "2025-10-01" });
    const s = await detectStaleItems(t.db, companyId, { classify });
    expect(s.inserted).toBe(0);
  });
});

describe("recomputeTimelines + clock", () => {
  it("flags items whose deadlines moved after a rule change and restores engine dates", async () => {
    await seed([CA_ITEM]);
    await detectStaleItems(t.db, companyId, { classify });
    const before = await byNumber("10482");
    // Simulate dates computed under an older rule version.
    await t.db.update(staleItems).set({ reportDueDate: "2029-01-01", ruleVersion: "old" }).where(eq(staleItems.id, before.id));
    const r = await recomputeTimelines(t.db, companyId);
    expect(r.deadlinesMoved).toBe(1);
    const after = await byNumber("10482");
    expect(after.reportDueDate).toBe(before.reportDueDate);
    expect(after.ruleVersion).toBe(before.ruleVersion);
    expect(after.deadlineMovedAt).not.toBeNull();
    // Stable now: a second pass moves nothing.
    expect((await recomputeTimelines(t.db, companyId)).deadlinesMoved).toBe(0);
  });

  it("clock advance walks watching -> dd_pending (one outreach draft) -> to_report", async () => {
    await seed([CA_ITEM]);
    await detectStaleItems(t.db, companyId, { classify });
    const item = await byNumber("10482");
    expect(item.status).toBe("watching");

    await advanceClock(t.db, companyId, diffDays(ANCHOR as IsoDate, item.ddWindowStart as IsoDate));
    const r1 = await recomputeTimelines(t.db, companyId);
    expect(r1.transitions).toHaveLength(1);
    expect(r1.transitions[0]).toMatchObject({ from: "watching", to: "dd_pending", outreachDraftCreated: true });
    expect((await byNumber("10482")).status).toBe("dd_pending");
    const drafts = () => t.db.select().from(outreach).where(eq(outreach.staleItemId, item.id));
    expect(await drafts()).toHaveLength(1);
    expect((await drafts())[0]).toMatchObject({ channel: "letter", status: "draft", sentAt: null });

    // Re-running creates neither a transition nor another draft.
    expect((await recomputeTimelines(t.db, companyId)).transitions).toHaveLength(0);
    expect(await drafts()).toHaveLength(1);

    await advanceClock(t.db, companyId, diffDays(item.ddWindowStart as IsoDate, item.ddWindowEnd as IsoDate));
    const r2 = await recomputeTimelines(t.db, companyId);
    expect(r2.transitions[0]).toMatchObject({ from: "dd_pending", to: "to_report" });
    expect((await byNumber("10482")).status).toBe("to_report");
    expect(await drafts()).toHaveLength(1);
  });

  it("a long jump crosses several states in one pass and still creates exactly one draft path", async () => {
    await seed([CA_ITEM]);
    await detectStaleItems(t.db, companyId, { classify });
    const item = await byNumber("10482");
    await advanceClock(t.db, companyId, diffDays(ANCHOR as IsoDate, item.ddWindowEnd as IsoDate));
    await recomputeTimelines(t.db, companyId);
    expect((await byNumber("10482")).status).toBe("to_report");
  });
});

describe("advanceItem", () => {
  it("advances one item and reports the wake date; terminal items stop", async () => {
    await seed([CA_ITEM]);
    await detectStaleItems(t.db, companyId, { classify });
    const item = await byNumber("10482");
    const a = await advanceItem(t.db, item.id);
    expect(a).toMatchObject({ found: true, status: "watching", terminal: false, changed: false, nextWakeAt: item.ddWindowStart });
    await t.db.update(staleItems).set({ status: "resolved_paid" }).where(eq(staleItems.id, item.id));
    expect(await advanceItem(t.db, item.id)).toMatchObject({ terminal: true, nextWakeAt: null });
    expect(await advanceItem(t.db, "00000000-0000-4000-8000-000000000000")).toMatchObject({ found: false, terminal: true });
  });

  it("waitTimeoutMs clamps to [1 min, 30 d]", () => {
    expect(waitTimeoutMs("2026-11-01", null)).toBe(30 * 86_400_000);
    expect(waitTimeoutMs("2026-11-01", "2026-11-01")).toBe(60_000);
    expect(waitTimeoutMs("2026-11-01", "2026-11-04")).toBe(3 * 86_400_000);
    expect(waitTimeoutMs("2026-11-01", "2030-01-01")).toBe(30 * 86_400_000);
  });
});
