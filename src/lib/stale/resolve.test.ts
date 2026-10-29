import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/db/client";
import { approvals, staleItems } from "@/db/schema";
import { seedItem } from "@/lib/outreach/testing";
import { advanceClock, now as clockNow } from "@/lib/clock";
import { markResolvedPaid, ResolveError } from "./resolve";

let t: TestDb;
beforeEach(async () => {
  t = await createTestDb();
});
afterEach(() => t.close());

const status = async (id: string) => (await t.db.select().from(staleItems).where(eq(staleItems.id, id)))[0]!;

describe("markResolvedPaid (H2: the only path to resolved_paid besides a bank clear)", () => {
  it("moves an owner_responded item to resolved_paid with an approval row and the approver recorded", async () => {
    const { stale } = await seedItem(t.db, { status: "owner_responded" });
    const res = await markResolvedPaid(t.db, { staleItemId: stale.id, expectedStatus: "owner_responded", by: "Dana (passcode session abcd1234)" });
    expect(res.status).toBe("resolved_paid");
    const row = await status(stale.id);
    expect(row.status).toBe("resolved_paid");
    expect(row.resolvedAt).toBeInstanceOf(Date);
    expect((row.classification as { resolution: { by: string } }).resolution.by).toBe("Dana (passcode session abcd1234)");
    const [ap] = await t.db.select().from(approvals).where(eq(approvals.id, res.approvalId));
    expect(ap).toMatchObject({ action: "mark_resolved_paid", subjectId: stale.id });
    expect(ap?.consumedAt).not.toBeNull();
  });
  it("refuses when the status changed since the reviewer looked (stale view)", async () => {
    const { stale } = await seedItem(t.db, { status: "to_report" });
    await expect(markResolvedPaid(t.db, { staleItemId: stale.id, expectedStatus: "owner_responded", by: "Dana" })).rejects.toMatchObject({ code: "status_changed" });
    expect((await status(stale.id)).status).toBe("to_report");
  });
  it("refuses terminal items and unknown items", async () => {
    const { stale } = await seedItem(t.db, { status: "remitted" });
    await expect(markResolvedPaid(t.db, { staleItemId: stale.id, expectedStatus: "remitted", by: "Dana" })).rejects.toBeInstanceOf(ResolveError);
    await expect(markResolvedPaid(t.db, { staleItemId: crypto.randomUUID(), expectedStatus: "watching", by: "Dana" })).rejects.toMatchObject({ code: "not_found" });
  });
  it("records the company's clock date (demo date), not the wall clock, as the resolution date", async () => {
    const { stale } = await seedItem(t.db, { status: "owner_responded" });
    await advanceClock(t.db, stale.companyId, 365);
    const today = await clockNow(t.db, stale.companyId);
    await markResolvedPaid(t.db, { staleItemId: stale.id, expectedStatus: "owner_responded", by: "Dana" });
    const row = await status(stale.id);
    expect((row.classification as { resolution: { at: string } }).resolution.at).toBe(today);
    expect(row.resolvedAt?.toISOString().slice(0, 10)).toBe(today);
  });
  it("requires a named approver", async () => {
    const { stale } = await seedItem(t.db, { status: "owner_responded" });
    await expect(markResolvedPaid(t.db, { staleItemId: stale.id, expectedStatus: "owner_responded", by: "  " })).rejects.toThrow();
  });
});
