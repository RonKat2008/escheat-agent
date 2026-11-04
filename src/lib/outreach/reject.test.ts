import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "@/db/client";
import { approvals, outreach } from "@/db/schema";
import { listActivity } from "@/lib/queries/activity";
import { listDiscards } from "@/lib/queries/discards";
import { discardedDraftPayload, rejectOutreach } from "./reject";
import { seedItem, markSentForTest } from "./testing";
import { requestApprovalPayloadHash } from "@/lib/approvals";

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => {
  await t.close();
});

async function draft() {
  const seeded = await seedItem(t.db, { ownerState: "CA" });
  const [row] = await t.db
    .insert(outreach)
    .values({ companyId: seeded.company.id, staleItemId: seeded.stale.id, channel: "letter", status: "draft", subject: "Unclaimed property notice", body: "Dear owner" })
    .returning();
  return { ...seeded, row: row! };
}

describe("rejectOutreach audit trail", () => {
  it("writes a discard_draft approvals row with approver, reason, payload hash and time", async () => {
    const { row } = await draft();
    const at = new Date("2026-10-20T09:30:00Z");
    await rejectOutreach(t.db, row.id, "Dana Reyes", "  Wrong owner address ", at);
    const rows = await t.db.select().from(approvals).where(eq(approvals.subjectId, row.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: "discard_draft", approvedBy: "Dana Reyes", reason: "Wrong owner address", consumedAt: null });
    expect(rows[0]!.approvedAt?.toISOString()).toBe(at.toISOString());
    expect(rows[0]!.payloadSha256).toBe(requestApprovalPayloadHash(discardedDraftPayload(row)));
    expect((await listDiscards(t.db, [row.id]))[0]).toMatchObject({ by: "Dana Reyes", reason: "Wrong owner address", payloadHash: rows[0]!.payloadSha256.slice(0, 12) });
  });

  it("writes nothing when the draft is already approved or sent", async () => {
    const { row } = await draft();
    await markSentForTest(t.db, row.id);
    await expect(rejectOutreach(t.db, row.id, "Dana Reyes", "too late")).rejects.toThrow(/cannot|Only a draft/i);
    const rows = await t.db.select().from(approvals).where(eq(approvals.subjectId, row.id));
    expect(rows.filter((r) => r.action === "discard_draft")).toHaveLength(0);
  });
});

describe("Activity mapping of a discarded draft", () => {
  it("shows one plain entry with the payee, reason and approver, and no 'Approved' entry for it", async () => {
    const { row, company } = await draft();
    await rejectOutreach(t.db, row.id, "Dana Reyes", "Wrong owner address", new Date("2026-10-21T10:00:00Z"));
    const { entries } = await listActivity(t.db, company.id, { kinds: ["approval"] });
    expect(entries).toHaveLength(1);
    const e = entries[0]!;
    expect(e.title).toBe("Discarded the due-diligence letter draft for Bayline Electric");
    expect(e.detail).toContain("Reason: Wrong owner address");
    expect(e.detail).toContain("Nothing was sent");
    expect(e.actor).toBe("Dana Reyes");
    expect(e.payloadHash).toMatch(/^[0-9a-f]{12}$/);
    expect(e.attention).toBe(false);
  });
});
