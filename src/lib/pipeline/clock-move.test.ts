import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/db/client";
import { companies, demoClockEvents, ledgerItems, staleItems } from "@/db/schema";
import { heuristicClassify, type classifyBatch } from "@/lib/agents/classifier";
import { loadClockHistory } from "@/lib/clock-history";
import { now } from "@/lib/clock";
import { getExposure } from "@/lib/queries/exposure";
import { getHorizon } from "@/lib/queries/horizon";
import { activityDensity, listActivity } from "@/lib/queries/activity";
import { detectStaleItems } from "./detect";
import { detectOnClock, moveDemoClock } from "./clock-move";
import { resetDemoClock } from "./clock-reset";

const ANCHOR = "2026-11-01";
let prevAnchor: string | undefined;
let prevDemo: string | undefined;
beforeAll(() => {
  prevAnchor = process.env.DEMO_ANCHOR_DATE;
  prevDemo = process.env.DEMO_MODE;
  process.env.DEMO_ANCHOR_DATE = ANCHOR;
  process.env.DEMO_MODE = "1";
});
afterAll(() => {
  if (prevAnchor === undefined) delete process.env.DEMO_ANCHOR_DATE;
  else process.env.DEMO_ANCHOR_DATE = prevAnchor;
  if (prevDemo === undefined) delete process.env.DEMO_MODE;
  else process.env.DEMO_MODE = prevDemo;
});

const classify: typeof classifyBatch = async (items, opts) => items.map((i) => heuristicClassify(i, opts.ctx));

let t: TestDb;
let companyId: string;
// 10501 is stale at the anchor; 10502 (Jul 1, 2026) crosses the 180-day line on Dec 29, 2026; 10503 stays fresh.
const ITEMS = [
  { number: "10501", payee: "Bayline Electric", issue: "2025-09-01", cents: 234_000 },
  { number: "10502", payee: "Harbor Paint", issue: "2026-07-01", cents: 54_321 },
  { number: "10503", payee: "Coastal Glass", issue: "2026-10-15", cents: 11_100 },
];

beforeEach(async () => {
  t = await createTestDb();
  const [c] = await t.db.insert(companies).values({ name: "Test Co", incorporationState: "DE" }).returning();
  companyId = c!.id;
  for (const i of ITEMS) {
    await t.db.insert(ledgerItems).values({
      companyId,
      payeeNameRaw: i.payee,
      propertyType: "vendor_check",
      referenceNumber: i.number,
      amountCents: i.cents,
      issueDate: i.issue,
      addressLine: "1 Main St",
      city: "Austin",
      state: "TX",
      zip: "78701",
      memo: "Invoice INV-1 services",
    });
  }
  // The seed: clock at the anchor, then detection.
  await resetDemoClock(t.db, companyId);
  await detectStaleItems(t.db, companyId, { classify });
});
afterEach(async () => {
  await t.close();
});

const liability = async () => (await getExposure(t.db, companyId)).total.cents;
const staleNumbers = async () =>
  (
    await t.db
      .select({ n: ledgerItems.referenceNumber })
      .from(staleItems)
      .innerJoin(ledgerItems, eq(ledgerItems.id, staleItems.ledgerItemId))
      .where(eq(staleItems.companyId, companyId))
  )
    .map((r) => r.n)
    .sort();

describe("moveDemoClock (R8-01)", () => {
  it("detects items that crossed the stale line, so the liability and Horizon agree after +90 days", async () => {
    expect(await staleNumbers()).toEqual(["10501"]);
    const before = await liability();
    expect(before).toBe(234_000);

    const res = await moveDemoClock(t.db, companyId, 90);
    expect(res.today).toBe("2027-01-30");
    expect(res.detected).toEqual({ count: 1, cents: 54_321, byState: { TX: 1 } });
    expect(await staleNumbers()).toEqual(["10501", "10502"]);
    expect(await liability()).toBe(before + 54_321);

    const horizon = await getHorizon(t.db, companyId);
    expect(horizon.awaitingDetection).toEqual({ count: 0, cents: 0 });
    expect(horizon.items.map((i) => i.checkNumber)).toEqual(["10503"]);

    // The new item is identified on its stale date (Ledger), and labeled heuristic + clock-detected.
    const [row] = await t.db.select().from(staleItems).innerJoin(ledgerItems, eq(ledgerItems.id, staleItems.ledgerItemId)).where(eq(ledgerItems.referenceNumber, "10502"));
    expect(row!.stale_items.staleSince).toBe("2026-12-29");
    expect(row!.stale_items.classification).toMatchObject({ detectedBy: "clock", detectedOn: "2027-01-30", method: "heuristic" });
  });

  it("agrees after +365 days too, and is idempotent", async () => {
    const res = await moveDemoClock(t.db, companyId, 365);
    expect(res.detected.count).toBe(2);
    expect(await staleNumbers()).toEqual(["10501", "10502", "10503"]);
    expect((await getHorizon(t.db, companyId)).awaitingDetection.count).toBe(0);
    expect(await liability()).toBe(234_000 + 54_321 + 11_100);
    expect(await detectOnClock(t.db, companyId)).toEqual({ count: 0, cents: 0, byState: {} });
    expect((await moveDemoClock(t.db, companyId, 0)).detected.count).toBe(0);
    expect(await liability()).toBe(234_000 + 54_321 + 11_100);
  });

  it("moving back (or Reset) removes untouched clock detections, so day-0 numbers come back exactly", async () => {
    await moveDemoClock(t.db, companyId, 365);
    const back = await moveDemoClock(t.db, companyId, -300); // Jan 1, 2027: 10502 still stale, 10503 not yet
    expect(back.undetected).toBe(1);
    expect(await staleNumbers()).toEqual(["10501", "10502"]);
    const reset = await resetDemoClock(t.db, companyId);
    expect(reset.undetected).toBe(1);
    expect(await now(t.db, companyId)).toBe(ANCHOR);
    expect(await staleNumbers()).toEqual(["10501"]);
    expect(await liability()).toBe(234_000);
  });

  it("keeps a clock-detected item a person already acted on when the clock goes back", async () => {
    await moveDemoClock(t.db, companyId, 90);
    const [row] = await t.db.select({ id: staleItems.id }).from(staleItems).innerJoin(ledgerItems, eq(ledgerItems.id, staleItems.ledgerItemId)).where(eq(ledgerItems.referenceNumber, "10502"));
    await t.db.update(staleItems).set({ status: "dd_sent" }).where(eq(staleItems.id, row!.id));
    const reset = await resetDemoClock(t.db, companyId);
    expect(reset.undetected).toBe(0);
    expect(await staleNumbers()).toEqual(["10501", "10502"]);
  });
});

describe("Activity logs the clock move on the demo day (R8-09)", () => {
  it("shows the jump and the detection under the new demo day, and seed rows under the anchor", async () => {
    await moveDemoClock(t.db, companyId, 90);
    const clock = { history: await loadClockHistory(t.db, companyId), today: await now(t.db, companyId) };
    const page = await listActivity(t.db, companyId, { clock, limit: 50 });
    const jump = page.entries.find((e) => e.kind === "clock" && e.title.startsWith("Demo clock moved"));
    expect(jump).toMatchObject({ title: "Demo clock moved forward to Jan 30, 2027", demoDay: "2027-01-30" });
    expect(jump!.detail).toContain("From Nov 1, 2026 · +90 days");
    const detected = page.entries.find((e) => e.kind === "clock" && e.title.startsWith("Detected"));
    expect(detected).toMatchObject({ title: "Detected 1 newly stale item", demoDay: "2027-01-30" });
    expect(detected!.detail).toContain("$543.21");
    // Ingestion happened before the clock log started: it belongs on the anchor day, not on today's real date.
    for (const e of page.entries.filter((x) => x.kind === "ingestion")) expect(e.demoDay).toBe(ANCHOR);
  });

  it("does not log a 'move' for the seed's clock set (no day change)", async () => {
    const clock = { history: await loadClockHistory(t.db, companyId), today: await now(t.db, companyId) };
    const page = await listActivity(t.db, companyId, { clock, kinds: ["clock"], limit: 50 });
    expect(page.entries).toEqual([]);
  });
});

describe("Activity reads stored clock events, not inferred ones (R9-02)", () => {
  const feed = async () => {
    const clock = { history: await loadClockHistory(t.db, companyId), today: await now(t.db, companyId) };
    return (await listActivity(t.db, companyId, { clock, kinds: ["clock"], limit: 100 })).entries;
  };
  const stored = () => t.db.select().from(demoClockEvents).where(eq(demoClockEvents.companyId, companyId)).orderBy(asc(demoClockEvents.setAt));

  it("writes one event row per move in the same transaction: demo day, from, direction, detected and undetected", async () => {
    await moveDemoClock(t.db, companyId, 60); // Dec 31: 10502 crosses
    await moveDemoClock(t.db, companyId, -60); // back to Nov 1: it is removed again
    const rows = (await stored()).filter((r) => r.kind === "move");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ demoDay: "2026-12-31", prevDay: ANCHOR, direction: "forward", detectedCount: 1, detectedCents: 54_321, undetectedCount: 0 });
    expect(rows[1]).toMatchObject({ demoDay: ANCHOR, prevDay: "2026-12-31", direction: "back", detectedCount: 0, detectedCents: 0, undetectedCount: 1 });
  });

  it("rolls the event back with the move when it fails", async () => {
    const before = (await stored()).length;
    await expect(moveDemoClock(t.db, companyId, 1.5)).rejects.toThrow(RangeError);
    expect((await stored()).length).toBe(before);
    expect(await now(t.db, companyId)).toBe(ANCHOR);
  });

  it("two jumps in the same real minute give two detection rows, each on its own demo day", async () => {
    await moveDemoClock(t.db, companyId, 60); // Dec 31: 10502
    await moveDemoClock(t.db, companyId, 120); // Apr 30, 2027: 10503
    const [a, b] = (await stored()).filter((r) => r.kind === "move");
    expect(Math.abs(b!.setAt.getTime() - a!.setAt.getTime())).toBeLessThan(60_000);
    const detected = (await feed()).filter((e) => e.title.startsWith("Detected"));
    expect(detected.map((e) => [e.demoDay, e.title])).toEqual([
      ["2027-04-30", "Detected 1 newly stale item"],
      ["2026-12-31", "Detected 1 newly stale item"],
    ]);
    expect(detected[0]!.detail).toContain("$111.00");
    expect(detected[1]!.detail).toContain("$543.21");
  });

  it("moving back adds its own row and erases nothing", async () => {
    await moveDemoClock(t.db, companyId, 60);
    await moveDemoClock(t.db, companyId, 120);
    const before = (await feed()).map((e) => e.id);
    await moveDemoClock(t.db, companyId, -200); // Oct 12, 2026: both detections leave the pipeline
    const after = await feed();
    for (const id of before) expect(after.map((e) => e.id)).toContain(id);
    expect(after.length).toBeGreaterThan(before.length);
    const removed = after.find((e) => e.title === "Clock moved back · 2 detections removed");
    expect(removed).toMatchObject({ demoDay: "2026-10-12", kind: "clock" });
    expect(after.find((e) => e.title === "Demo clock moved back to Oct 12, 2026")).toBeDefined();
    expect(await staleNumbers()).toEqual(["10501"]);
  });

  it("Reset keeps the history and logs itself with the detections it removed", async () => {
    await moveDemoClock(t.db, companyId, 365);
    const before = (await feed()).map((e) => e.id);
    await resetDemoClock(t.db, companyId);
    const after = await feed();
    for (const id of before) expect(after.map((e) => e.id)).toContain(id);
    expect(after.find((e) => e.title === "Demo clock reset to Nov 1, 2026")?.demoDay).toBe(ANCHOR);
    expect(after.find((e) => e.title === "Clock reset · 2 detections removed")).toBeDefined();
    expect((await stored()).at(-1)).toMatchObject({ kind: "reset", direction: "back", undetectedCount: 2 });
  });

  it("a move that detects nothing still shows the jump, and a no-op move shows no row", async () => {
    await moveDemoClock(t.db, companyId, 5);
    await moveDemoClock(t.db, companyId, 0);
    expect((await feed()).map((e) => e.title)).toEqual(["Demo clock moved forward to Nov 6, 2026"]);
  });
});

describe("Activity chart covers the list's range (R9-10)", () => {
  it("the strip runs from the oldest listed demo day to the newest, and its total is the list's total", async () => {
    await moveDemoClock(t.db, companyId, 60); // Dec 31: far more than 30 days after the seed's Nov 1 rows
    const clock = { history: await loadClockHistory(t.db, companyId), today: await now(t.db, companyId) };
    const all = await listActivity(t.db, companyId, { clock, limit: 200 });
    const days = all.entries.map((e) => e.demoDay);
    const oldest = days.reduce((a, b) => (a < b ? a : b));
    expect(oldest).toBe(ANCHOR);
    const density = await activityDensity(t.db, companyId, { clock });
    expect(density.from).toBe(ANCHOR);
    expect(density.to).toBe("2026-12-31");
    expect(density.days).toHaveLength(61);
    expect(density.total).toBe(all.entries.length);
  });
});
