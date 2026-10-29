import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/db/client";
import { companies, recoveries } from "@/db/schema";
import { eq } from "drizzle-orm";
import { assertApproved, ReviewedContentChangedError } from "@/lib/approvals";
import { approveClaim, listRecoveries, RecoveryServiceError } from "./service";

let t: TestDb;
let companyId: string;
beforeEach(async () => {
  t = await createTestDb();
  const [c] = await t.db.insert(companies).values({ name: "Test Co", incorporationState: "DE" }).returning();
  companyId = c!.id;
});
afterEach(() => t.close());

describe("recoveries service", () => {
  it("drafts a payload, records a file_claim approval bound to it, and refuses a second approval", async () => {
    const [r] = await t.db
      .insert(recoveries)
      .values({ companyId, state: "TX", amountCents: 118000, matchedNameVariant: "Northwind Fixtures Inc" })
      .returning();
    const saved = await approveClaim(t.db, r!.id, "Pat");
    expect(saved.approvalId).toBeTruthy();
    expect(saved.status).toBe("awaiting_approval");
    await expect(assertApproved(t.db, { action: "file_claim", subjectId: r!.id, payload: saved.claimPayload })).resolves.toBeTruthy();
    await expect(approveClaim(t.db, r!.id, "Pat")).rejects.toBeInstanceOf(RecoveryServiceError);
    const list = await listRecoveries(t.db, companyId);
    expect(list[0]!.approval?.approvedBy).toBe("Pat");
  });

  it("M2: approval requires the payload hash the reviewer saw; a changed claim is rejected", async () => {
    const [r] = await t.db.insert(recoveries).values({ companyId, state: "TX", amountCents: 118000, matchedNameVariant: "Northwind" }).returning();
    const seen = (await listRecoveries(t.db, companyId))[0]!.payloadSha256;
    await t.db.update(recoveries).set({ amountCents: 999999, claimPayload: { kind: "replica_claim", amountCents: 999999 } }).where(eq(recoveries.id, r!.id));
    await expect(approveClaim(t.db, r!.id, "Pat", { expectedPayloadSha256: seen })).rejects.toBeInstanceOf(ReviewedContentChangedError);
    const fresh = (await listRecoveries(t.db, companyId))[0]!.payloadSha256;
    expect(fresh).not.toBe(seen);
    await expect(approveClaim(t.db, r!.id, "Pat", { expectedPayloadSha256: fresh })).resolves.toMatchObject({ status: "awaiting_approval" });
  });

  it("rejects unknown ids", async () => {
    await expect(approveClaim(t.db, "00000000-0000-4000-8000-000000000000", "Pat")).rejects.toThrow(/not found/);
  });
});
