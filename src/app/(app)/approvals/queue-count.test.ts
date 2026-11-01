import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/db/client";
import { outreach, recoveries, reports, ruleChanges } from "@/db/schema";
import { seedItem } from "@/lib/outreach/testing";
import { countWaiting } from "./queue-count";
import { loadQueue } from "./queue-data";

let t: TestDb;
beforeEach(async () => {
  t = await createTestDb();
});
afterEach(async () => {
  await t.close();
});

describe("approvals queue count", () => {
  it("is identical for the list header and the sidebar badge, and drops an offline-sent letter", async () => {
    const { company, stale } = await seedItem(t.db);
    const base = { companyId: company.id, staleItemId: stale.id, channel: "letter" as const };
    await t.db.insert(outreach).values([
      { ...base, status: "draft" },
      { ...base, channel: "email", status: "awaiting_approval" },
      { ...base, channel: "voice", status: "approved" },
      { ...base, status: "failed" },
      { ...base, status: "sent", offline: true },
      { ...base, status: "cancelled" },
    ]);
    await t.db.insert(reports).values([
      { companyId: company.id, state: "CA", reportYear: 2026, status: "validated" },
      { companyId: company.id, state: "TX", reportYear: 2026, status: "approved" },
    ]);
    await t.db.insert(recoveries).values([{ companyId: company.id, state: "CA", amountCents: 1000, status: "found" }]);
    await t.db.insert(ruleChanges).values([{ state: "DE", diff: {}, status: "proposed" }]);

    const queue = await loadQueue(t.db, company.id);
    const listCount = queue.entries.filter((e) => e.actionable).length;
    expect(await countWaiting(t.db, company.id)).toBe(listCount);
    // 4 pending outreach (draft, awaiting, approved, failed) + 1 validated report + 1 recovery + 1 rule change
    expect(listCount).toBe(7);
  });

  it("an offline send moves the letter out of the count", async () => {
    const { company, stale } = await seedItem(t.db);
    const [row] = await t.db.insert(outreach).values({ companyId: company.id, staleItemId: stale.id, channel: "letter", status: "approved" }).returning();
    expect(await countWaiting(t.db, company.id)).toBe(1);
    const { eq } = await import("drizzle-orm");
    await t.db.update(outreach).set({ status: "sent", offline: true }).where(eq(outreach.id, row!.id));
    expect(await countWaiting(t.db, company.id)).toBe(0);
    expect((await loadQueue(t.db, company.id)).entries.filter((e) => e.actionable)).toHaveLength(0);
  });
});
