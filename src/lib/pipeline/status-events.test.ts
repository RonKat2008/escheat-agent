import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/db/client";
import { outreach, outreachItems, staleItems, type StaleStatus } from "@/db/schema";
import type { IsoDate } from "@/lib/dates";
import { insertFixture, STANDARD_ITEMS } from "@/lib/queries/test-fixtures";
import { resetDemoClock } from "./clock-reset";
import { recomputeAfterOutreach, statusAfterPersonEvents, type EventItem } from "./status-events";

const TODAY = "2026-11-01" as IsoDate;
const item = (status: StaleStatus, over: Partial<EventItem> = {}): EventItem => ({
  status,
  presumedAbandonedDate: null,
  ddWindowStart: "2026-10-01",
  ddWindowEnd: "2026-12-01",
  reportDueDate: "2027-07-01",
  remitDueDate: "2027-07-01",
  reportStage: null,
  ruleVersion: null,
  dependsOnUnverified: false,
  ddApplies: true,
  ...over,
});

describe("statusAfterPersonEvents (pure, the timeline machine)", () => {
  it("a sent letter moves a pending item to dd_sent; a reply to owner_responded", () => {
    expect(statusAfterPersonEvents(item("dd_pending"), { letterSent: true, ownerResponded: false }, TODAY)).toBe("dd_sent");
    expect(statusAfterPersonEvents(item("watching"), { letterSent: true, ownerResponded: false }, TODAY)).toBe("dd_sent");
    expect(statusAfterPersonEvents(item("dd_sent"), { letterSent: true, ownerResponded: true }, TODAY)).toBe("owner_responded");
  });

  it("the machine still applies the date: a reply after the DD window closed lands on to_report", () => {
    expect(statusAfterPersonEvents(item("dd_sent", { ddWindowEnd: "2026-10-15" }), { letterSent: true, ownerResponded: true }, TODAY)).toBe("to_report");
  });

  it("never moves filed or closed items, and nothing happens without a person's action", () => {
    for (const s of ["to_report", "reported", "remitted", "resolved_paid"] as const) {
      expect(statusAfterPersonEvents(item(s), { letterSent: true, ownerResponded: true }, TODAY)).toBe(s);
    }
    expect(statusAfterPersonEvents(item("dd_pending"), { letterSent: false, ownerResponded: false }, TODAY)).toBe("dd_pending");
  });
});

describe("recomputeAfterOutreach (R5-09)", () => {
  let t: TestDb;
  let companyId: string;
  let ids: Awaited<ReturnType<typeof insertFixture>>["ids"];
  const prev = process.env.DEMO_ANCHOR_DATE;
  beforeAll(() => {
    process.env.DEMO_ANCHOR_DATE = TODAY;
  });
  afterAll(() => {
    if (prev === undefined) delete process.env.DEMO_ANCHOR_DATE;
    else process.env.DEMO_ANCHOR_DATE = prev;
  });
  beforeEach(async () => {
    t = await createTestDb();
    ({ companyId, ids } = await insertFixture(t.db, STANDARD_ITEMS));
  });
  afterEach(async () => {
    await t.close();
  });
  const statusOf = async (id: string) => (await t.db.select({ s: staleItems.status }).from(staleItems).where(eq(staleItems.id, id)))[0]!.s;

  it("a sent one-notice letter moves every item it lists at once, and a clock Reset agrees", async () => {
    // b (TX dd_pending) is the letter's lead; a (CA watching) rides on outreach_items.
    const [o] = await t.db.insert(outreach).values({ companyId, staleItemId: ids.b!.staleId, channel: "letter", status: "approved" }).returning();
    await t.db.insert(outreachItems).values({ outreachId: o!.id, staleItemId: ids.a!.staleId, amountCents: 234000, position: 1 });
    expect(await recomputeAfterOutreach(t.db, o!.id)).toEqual([]); // not sent yet: nothing moves

    await t.db.update(outreach).set({ status: "sent", offline: true }).where(eq(outreach.id, o!.id));
    const changes = await recomputeAfterOutreach(t.db, o!.id);
    expect(changes.map((c) => c.to).sort()).toEqual(["dd_sent", "dd_sent"]);
    expect(await statusOf(ids.b!.staleId)).toBe("dd_sent");
    expect(await statusOf(ids.a!.staleId)).toBe("dd_sent");
    expect(await recomputeAfterOutreach(t.db, o!.id)).toEqual([]); // idempotent

    // The same demo date shows the same lead status whether or not the clock was touched.
    await resetDemoClock(t.db, companyId);
    expect(await statusOf(ids.b!.staleId)).toBe("dd_sent");
  });
});
