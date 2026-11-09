/**
 * R11-02: a second approval of the same subject + payload hash is refused (409 already_approved), writes no chain row,
 * and keeps the original approver. Two concurrent approvals give exactly one success. Chains still verify.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/db/client";
import { approvals, auditChain, companies, outreach, staleItems, ledgerItems } from "@/db/schema";
import { verifyChain } from "@/lib/audit/chain-db";
import { errorInfo } from "@/lib/outreach/http";
import { AlreadyApprovedError, approve, consumeApproval, withApproval } from "./approvals";
import { cardApprovalStatus } from "./ask/cards/approval-status";

let t: TestDb;
let companyId: string;
let n = 0;

/** A stale item owned by the test company, so approval events land on its chain. */
async function subject(): Promise<string> {
  const [li] = await t.db
    .insert(ledgerItems)
    .values({ companyId, payeeNameRaw: `Payee ${++n}`, propertyType: "vendor_check", referenceNumber: `R${n}`, amountCents: 1000 + n, issueDate: "2023-01-01", status: "outstanding", rawRow: {}, source: "csv" })
    .returning();
  const [si] = await t.db.insert(staleItems).values({ companyId, ledgerItemId: li!.id, amountCents: li!.amountCents, propertyType: "vendor_check", staleSince: "2025-01-01", status: "dd_pending" }).returning();
  return si!.id;
}

const chainLength = async () => (await t.db.select().from(auditChain).where(eq(auditChain.companyId, companyId))).length;

beforeAll(async () => {
  t = await createTestDb();
  const [c] = await t.db.insert(companies).values({ name: "Double Approval Co", incorporationState: "DE" }).returning();
  companyId = c!.id;
});
afterAll(async () => {
  await t.close();
});

describe("R11-02 second approval", () => {
  it("is refused with already_approved, no new chain row, original approver kept", async () => {
    const s = await subject();
    const ref = { action: "mail_letter" as const, subjectId: s, payload: { body: "hello" } };
    const first = await approve(t.db, { ...ref, approvedBy: "Dogfood Controller (passcode session abc123)" });
    const before = await chainLength();

    const err = await approve(t.db, { ...ref, approvedBy: "Second Person" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AlreadyApprovedError);
    const e = err as AlreadyApprovedError;
    expect(e.approvedBy).toBe("Dogfood Controller");
    expect(e.approvalId).toBe(first.id);
    expect(e.message).toMatch(/^Already approved by Dogfood Controller/);
    expect(errorInfo(e)).toMatchObject({ status: 409, extra: { code: "already_approved", approvedBy: "Dogfood Controller" } });

    expect(await chainLength()).toBe(before);
    const rows = await t.db.select().from(approvals).where(eq(approvals.subjectId, s));
    expect(rows.map((r) => r.approvedBy)).toEqual(["Dogfood Controller (passcode session abc123)"]);
    expect((await verifyChain(t.db, companyId)).ok).toBe(true);
  });

  it("a changed payload can still be approved (the old approval no longer covers it)", async () => {
    const s = await subject();
    await approve(t.db, { action: "mail_letter", subjectId: s, payload: { body: "v1" }, approvedBy: "A Person" });
    await expect(approve(t.db, { action: "mail_letter", subjectId: s, payload: { body: "v2" }, approvedBy: "B Person" })).resolves.toBeDefined();
  });

  it("a consumed approval does not block a fresh one (send, then approve again)", async () => {
    const s = await subject();
    const ref = { action: "mail_letter" as const, subjectId: s, payload: { body: "x" } };
    const a = await approve(t.db, { ...ref, approvedBy: "A Person" });
    await consumeApproval(t.db, a.id);
    await expect(approve(t.db, { ...ref, approvedBy: "B Person" })).resolves.toBeDefined();
  });

  it("a released approval (executor failed before the irreversible step) lets an approve-and-execute caller retry", async () => {
    const s = await subject();
    const ref = { action: "mark_resolved_paid" as const, subjectId: s, payload: { p: 1 } };
    await approve(t.db, { ...ref, approvedBy: "A Person" });
    await expect(withApproval(t.db, ref, async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    await expect(approve(t.db, { ...ref, approvedBy: "A Person" })).resolves.toBeDefined();
    expect((await verifyChain(t.db, companyId)).ok).toBe(true);
  });

  it("concurrent double approval: exactly one succeeds, one granted event", async () => {
    const s = await subject();
    const ref = { action: "mail_letter" as const, subjectId: s, payload: { body: "race" } };
    const before = await chainLength();
    const results = await Promise.allSettled([approve(t.db, { ...ref, approvedBy: "First Racer" }), approve(t.db, { ...ref, approvedBy: "Second Racer" })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBeInstanceOf(AlreadyApprovedError);
    expect(await t.db.select().from(approvals).where(eq(approvals.subjectId, s))).toHaveLength(1);
    expect(await chainLength()).toBe(before + 1);
    expect((await verifyChain(t.db, companyId)).ok).toBe(true);
  });
});

describe("R11-02 card status", () => {
  it("reads an approved letter as approved by the typed name, and a waiting one as not approved", async () => {
    const s = await subject();
    const [o] = await t.db.insert(outreach).values({ companyId, staleItemId: s, channel: "letter", status: "awaiting_approval" }).returning();
    expect(await cardApprovalStatus(t.db, "outreach", o!.id)).toEqual({ approved: false, approvedBy: null, approvedAt: null });
    const a = await approve(t.db, { action: "mail_letter", subjectId: o!.id, payload: { v: 1 }, approvedBy: "Dogfood Controller (passcode session abc123)" });
    await t.db.update(outreach).set({ status: "approved", approvalId: a.id }).where(eq(outreach.id, o!.id));
    expect(await cardApprovalStatus(t.db, "outreach", o!.id)).toMatchObject({ approved: true, approvedBy: "Dogfood Controller" });
    expect(await cardApprovalStatus(t.db, "outreach", "00000000-0000-4000-8000-000000000000")).toBeNull();
  });
});
