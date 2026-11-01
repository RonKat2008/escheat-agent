import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/db/client";
import { companies, ledgerItems, outreach, staleItems } from "@/db/schema";
import { heuristicClassify, type classifyBatch } from "@/lib/agents/classifier";
import { advanceClock, now } from "@/lib/clock";
import { detectStaleItems } from "./detect";
import { recomputeTimelines } from "./recompute";
import { resetDemoClock } from "./clock-reset";

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

const classify: typeof classifyBatch = async (items, opts) => items.map((i) => heuristicClassify(i, opts.ctx));

let t: TestDb;
let companyId: string;
beforeEach(async () => {
  t = await createTestDb();
  const [c] = await t.db.insert(companies).values({ name: "Test Co", incorporationState: "DE" }).returning();
  companyId = c!.id;
  const items = [
    // Watching at the anchor (DD window opens Oct 2028).
    { number: "10482", payee: "Bayline Electric", issue: "2025-09-01" },
    // Inside the DD window at the anchor (opens Nov 1 2026): dd_pending with a draft created at the anchor.
    { number: "10483", payee: "Harbor Paint", issue: "2023-06-01" },
    // Second in-window item: a person sends its letter after the clock moves.
    { number: "10484", payee: "Coastal Glass", issue: "2023-06-02" },
  ];
  for (const i of items) {
    await t.db.insert(ledgerItems).values({
      companyId,
      payeeNameRaw: i.payee,
      propertyType: "vendor_check",
      referenceNumber: i.number,
      amountCents: 234000,
      issueDate: i.issue,
      addressLine: "1 Main St",
      city: "Sacramento",
      state: "CA",
      zip: "95814",
      memo: "Invoice INV-1 services",
    });
  }
  await detectStaleItems(t.db, companyId, { classify });
});
afterEach(async () => {
  await t.close();
});

const byNumber = async (n: string) => {
  const [r] = await t.db
    .select({ s: staleItems })
    .from(staleItems)
    .innerJoin(ledgerItems, eq(ledgerItems.id, staleItems.ledgerItemId))
    .where(eq(ledgerItems.referenceNumber, n));
  return r!.s;
};
const statuses = async () => Object.fromEntries(await Promise.all(["10482", "10483", "10484"].map(async (n) => [n, (await byNumber(n)).status])));
const lettersFor = async (n: string) => t.db.select().from(outreach).where(eq(outreach.staleItemId, (await byNumber(n)).id));
const advance = async (days: number) => {
  await advanceClock(t.db, companyId, days);
  return recomputeTimelines(t.db, companyId);
};

describe("resetDemoClock (F17)", () => {
  it("restores the anchor-date statuses and removes letters auto-drafted after the anchor", async () => {
    const atAnchor = await statuses();
    expect(atAnchor).toEqual({ "10482": "watching", "10483": "dd_pending", "10484": "dd_pending" });
    const anchorDrafts = (await t.db.select().from(outreach)).map((o) => o.id).sort();
    expect(anchorDrafts).toHaveLength(2);

    await advance(90);
    await advance(365 * 2); // 10482 enters its DD window (auto-draft); the others pass theirs (to_report)
    const moved = await statuses();
    expect(moved["10482"]).toBe("dd_pending");
    expect(moved["10483"]).toBe("to_report");
    expect(await lettersFor("10482")).toHaveLength(1);

    const res = await resetDemoClock(t.db, companyId);
    expect(res.today).toBe(ANCHOR);
    expect(await now(t.db, companyId)).toBe(ANCHOR);
    expect(await statuses()).toEqual(atAnchor);
    expect((await t.db.select().from(outreach)).map((o) => o.id).sort()).toEqual(anchorDrafts);
    expect(res.removedDrafts).toBe(1);
    expect(res.restored).toBe(3);
    expect(res.transitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: "dd_pending", to: "watching" }),
        expect.objectContaining({ from: "to_report", to: "dd_pending" }),
      ]),
    );
  });

  it("keeps what a person did: a sent letter stays sent and its item restarts from dd_sent", async () => {
    await advance(30);
    const [letter] = await lettersFor("10484");
    await t.db.update(outreach).set({ status: "sent", sentAt: new Date() }).where(eq(outreach.id, letter!.id));
    await t.db.update(staleItems).set({ status: "dd_sent" }).where(eq(staleItems.id, letter!.staleItemId));
    await advance(365); // past the window end: dd_sent -> to_report

    expect((await byNumber("10484")).status).toBe("to_report");
    const res = await resetDemoClock(t.db, companyId);
    expect((await byNumber("10484")).status).toBe("dd_sent");
    expect((await lettersFor("10484"))[0]).toMatchObject({ id: letter!.id, status: "sent" });
    expect(res.keptHumanActions).toBeGreaterThanOrEqual(1);
  });

  it("does not delete a draft a person has started working on (no longer a bare draft)", async () => {
    await advance(365 * 2);
    const [draft] = await lettersFor("10482");
    await t.db.update(outreach).set({ status: "awaiting_approval" }).where(eq(outreach.id, draft!.id));
    const res = await resetDemoClock(t.db, companyId);
    expect(await lettersFor("10482")).toHaveLength(1);
    expect(res.removedDrafts).toBe(0);
    expect(res.keptHumanActions).toBeGreaterThanOrEqual(1);
  });

  it("is deterministic and idempotent", async () => {
    await advance(365 * 3);
    await resetDemoClock(t.db, companyId);
    const first = { s: await statuses(), o: (await t.db.select().from(outreach)).map((o) => o.id).sort() };
    const again = await resetDemoClock(t.db, companyId);
    expect(again.transitions).toEqual([]);
    expect(again.removedDrafts).toBe(0);
    expect({ s: await statuses(), o: (await t.db.select().from(outreach)).map((o) => o.id).sort() }).toEqual(first);
  });
});
