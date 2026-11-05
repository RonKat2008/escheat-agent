import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/db/client";
import { bankClears, companies, demoClockEvents, ledgerItems } from "@/db/schema";
import { heuristicClassify, type classifyBatch } from "@/lib/agents/classifier";
import { detectStaleItems } from "@/lib/pipeline/detect";
import { moveDemoClock } from "@/lib/pipeline/clock-move";
import { resetDemoClock } from "@/lib/pipeline/clock-reset";
import { linkRows, parseSnapshot, reconcilePrediction, type PredictionSnapshot } from "./check";
import { loadHorizonChecks } from "./check-read";

const ANCHOR = "2026-11-01";
const env: Record<string, string | undefined> = {};
beforeAll(() => {
  env.anchor = process.env.DEMO_ANCHOR_DATE;
  env.demo = process.env.DEMO_MODE;
  process.env.DEMO_ANCHOR_DATE = ANCHOR;
  process.env.DEMO_MODE = "1";
});
afterAll(() => {
  if (env.anchor === undefined) delete process.env.DEMO_ANCHOR_DATE;
  else process.env.DEMO_ANCHOR_DATE = env.anchor;
  if (env.demo === undefined) delete process.env.DEMO_MODE;
  else process.env.DEMO_MODE = env.demo;
});

const classify: typeof classifyBatch = async (items, opts) => items.map((i) => heuristicClassify(i, opts.ctx));

let t: TestDb;
let companyId: string;
// 10501 is stale at the anchor; 10502 (Jul 1) crosses the 180-day line on Dec 29; 10503 stays fresh for +90 days.
const ITEMS = [
  { number: "10501", payee: "Bayline Electric", issue: "2025-09-01", cents: 234_000, state: "TX" },
  { number: "10502", payee: "Harbor Paint", issue: "2026-07-01", cents: 54_321, state: "TX" },
  { number: "10503", payee: "Coastal Glass", issue: "2026-10-15", cents: 11_100, state: "TX" },
];

async function addItem(i: { number: string; payee: string; issue: string; cents: number; state: string }) {
  const [row] = await t.db
    .insert(ledgerItems)
    .values({
      companyId,
      payeeNameRaw: i.payee,
      propertyType: "vendor_check",
      referenceNumber: i.number,
      amountCents: i.cents,
      issueDate: i.issue,
      addressLine: "1 Main St",
      city: "Somewhere",
      state: i.state,
      zip: "00000",
      memo: "Invoice INV-1 services",
    })
    .returning({ id: ledgerItems.id });
  return row!.id;
}

beforeEach(async () => {
  t = await createTestDb();
  const [c] = await t.db.insert(companies).values({ name: "Test Co", incorporationState: "DE" }).returning();
  companyId = c!.id;
  for (const i of ITEMS) await addItem(i);
  await resetDemoClock(t.db, companyId);
  await detectStaleItems(t.db, companyId, { classify });
});
afterEach(async () => {
  await t.close();
});

describe("Horizon prediction check (stored at move time, reconciled on read)", () => {
  it("has no entries before any clock move", async () => {
    expect(await loadHorizonChecks(t.db, companyId)).toEqual([]);
  });

  it("all match: Horizon's forecast on the previous day equals the move's detection, to the cent, with links", async () => {
    const res = await moveDemoClock(t.db, companyId, 90);
    const [entry] = await loadHorizonChecks(t.db, companyId);
    const check = entry!.check!;
    expect(entry!.prevDay).toBe(ANCHOR);
    expect(entry!.day).toBe(res.today);
    expect(check.status).toBe("all");
    expect(check.predicted).toEqual({ count: 1, cents: 54_321 });
    expect(check.detected).toEqual({ count: res.detected.count, cents: res.detected.cents });
    expect(check.matched.map((m) => m.check)).toEqual(["10502"]);
    expect(check.matched[0]!.href).toMatch(/^\/items\?item=[0-9a-f-]{36}$/);
    expect(check.matched[0]!.note).toBeNull();
  });

  it("a payment that cleared at the bank in between is predicted but not detected, with the clear date as the reason", async () => {
    const ledgerId = (await t.db.select({ id: ledgerItems.id }).from(ledgerItems).where(eq(ledgerItems.referenceNumber, "10502")))[0]!.id;
    await t.db.insert(bankClears).values({ companyId, referenceNumber: "10502", amountCents: 54_321, clearedDate: "2026-12-01" });
    await moveDemoClock(t.db, companyId, 90);
    const check = (await loadHorizonChecks(t.db, companyId))[0]!.check!;
    expect(check.status).toBe("differences");
    expect(check.predicted).toEqual({ count: 1, cents: 54_321 });
    expect(check.detected).toEqual({ count: 0, cents: 0 });
    expect(check.missed).toHaveLength(1);
    expect(check.missed[0]!.id).toBe(ledgerId);
    expect(check.missed[0]!.note).toContain("Cleared at the bank on Dec 1, 2026");
    expect(check.missed[0]!.href).toBeNull();
  });

  it("a state with no rule file is still predicted and detected (business stale line), and says it has no legal dates", async () => {
    await addItem({ number: "10504", payee: "Gulf Supply", issue: "2026-07-10", cents: 7_700, state: "FL" });
    await moveDemoClock(t.db, companyId, 90);
    const check = (await loadHorizonChecks(t.db, companyId))[0]!.check!;
    expect(check.status).toBe("all");
    expect(check.predicted).toEqual({ count: 2, cents: 54_321 + 7_700 });
    const fl = check.matched.find((m) => m.check === "10504")!;
    expect(fl.note).toBe("No rules for FL yet: detected as needs-rule, no legal dates.");
  });

  it("stores no forecast on back moves and lists forward moves newest first", async () => {
    await moveDemoClock(t.db, companyId, 30);
    await moveDemoClock(t.db, companyId, 60);
    await moveDemoClock(t.db, companyId, -10);
    const rows = await t.db.select({ dir: demoClockEvents.direction, hc: demoClockEvents.horizonCheck }).from(demoClockEvents).where(eq(demoClockEvents.direction, "back"));
    expect(rows.every((r) => r.hc === null)).toBe(true);
    const entries = await loadHorizonChecks(t.db, companyId);
    expect(entries.map((e) => [e.prevDay, e.day])).toEqual([
      ["2026-12-01", "2027-01-30"],
      [ANCHOR, "2026-12-01"],
    ]);
    // 10502 (stale Dec 29) was detected by the second move and survives the back move to Jan 20, so it keeps its link.
    expect(entries[0]!.check!.matched[0]!.href).not.toBeNull();
  });

  it("drops the link once the detected item is gone (clock reset), and says why", async () => {
    await moveDemoClock(t.db, companyId, 90);
    await resetDemoClock(t.db, companyId);
    const check = (await loadHorizonChecks(t.db, companyId))[0]!.check!;
    expect(check.matched[0]!.href).toBeNull();
    expect(check.matched[0]!.note).toContain("No longer in the pipeline");
  });
});

describe("reconcilePrediction (pure)", () => {
  const row = (id: string, cents: number, state: string | null = "TX") => ({ id, cents, check: id, payee: `P${id}`, state });
  const snap: PredictionSnapshot = {
    v: 1,
    asOf: "2026-11-01",
    by: "2026-12-01",
    thresholdDays: 180,
    predicted: [row("a", 100), row("b", 200)],
    detected: [
      { ...row("a", 100), itemId: "ia", staleOn: "2026-11-20" },
      { ...row("c", 300), itemId: "ic", staleOn: "2026-10-30" },
      { ...row("d", 50, null), itemId: "id", staleOn: "2026-11-25" },
    ],
    misses: [{ id: "b", why: "voided", on: null, itemId: null }],
  };

  it("lists each difference with its honest reason", () => {
    const r = reconcilePrediction(snap, ["TX"]);
    expect(r.status).toBe("differences");
    expect(r.predicted).toEqual({ count: 2, cents: 300 });
    expect(r.detected).toEqual({ count: 3, cents: 450 });
    expect(r.missed.map((m) => [m.id, m.reason])).toEqual([["b", "Voided in the ledger after the forecast."]]);
    expect(r.unexpected.map((u) => u.id)).toEqual(["c", "d"]);
    expect(r.unexpected[0]!.reason).toContain("Already past the stale line on 2026-11-01");
    expect(r.unexpected[1]!.reason).toContain("reason was not recorded");
  });

  it("never invents a reason for an unexplained miss, and only links live items", () => {
    const r = reconcilePrediction({ ...snap, misses: [] }, ["TX"]);
    expect(r.missed[0]!.reason).toBe("Not detected; the reason was not recorded.");
    const linked = linkRows(r, new Set(["ia"]));
    expect(linked.matched[0]!.href).toBe("/items?item=ia");
    expect(linked.unexpected[0]!.href).toBeNull();
    expect(linked.missed[0]!.note).toContain("no item page");
  });

  it("treats anything but a v1 snapshot as not recorded", () => {
    expect(parseSnapshot(null)).toBeNull();
    expect(parseSnapshot({ v: 2 })).toBeNull();
    expect(parseSnapshot(snap)).toBe(snap);
  });
});
