/** Recoveries: money owed BACK to the company, found by the recovery agent on REPLICA portals only. */
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { approvals, companies, recoveries, type Approval, type Recovery } from "@/db/schema";
import { approve, assertReviewedHash, requestApprovalPayloadHash } from "@/lib/approvals";

export class RecoveryServiceError extends Error {
  constructor(
    public readonly code: "not_found" | "not_approvable",
    message: string,
  ) {
    super(message);
    this.name = "RecoveryServiceError";
  }
}

export type RecoveryView = Recovery & {
  /** Approval that exists for this claim (null until a human approves). */
  approval: Pick<Approval, "id" | "approvedBy" | "approvedAt" | "consumedAt"> | null;
  /** Hash of the claim payload a reviewer would be approving now; the UI sends it back as expectedPayloadSha256 (M2). */
  payloadSha256: string;
};

export async function listRecoveries(db: Db, companyId: string): Promise<RecoveryView[]> {
  const rows = await db
    .select()
    .from(recoveries)
    .where(eq(recoveries.companyId, companyId))
    .orderBy(desc(recoveries.foundAt));
  const ids = rows.map((r) => r.approvalId).filter((x): x is string => !!x);
  const aps = ids.length
    ? await db
        .select({ id: approvals.id, approvedBy: approvals.approvedBy, approvedAt: approvals.approvedAt, consumedAt: approvals.consumedAt })
        .from(approvals)
        .where(inArray(approvals.id, ids))
    : [];
  const [company] = await db.select({ name: companies.name }).from(companies).where(eq(companies.id, companyId));
  return rows.map((r) => ({
    ...r,
    approval: aps.find((a) => a.id === r.approvalId) ?? null,
    payloadSha256: requestApprovalPayloadHash(r.claimPayload ?? buildClaimPayload(r, company?.name ?? null)),
  }));
}

export async function getRecovery(db: Db, id: string): Promise<Recovery | null> {
  const [row] = await db.select().from(recoveries).where(eq(recoveries.id, id));
  return row ?? null;
}

/** Pure deterministic claim draft built only from stored facts. */
export function buildClaimPayload(recovery: Recovery, companyName: string | null): Record<string, unknown> {
  return {
    kind: "replica_claim",
    state: recovery.state,
    claimant: companyName,
    amountCents: recovery.amountCents,
    matchedNameVariant: recovery.matchedNameVariant,
    holderNameFound: recovery.holderNameFound,
  };
}

/** Hash of the payload approveClaim would bind to right now (persisted agent draft, else the deterministic one). */
export async function claimPayloadSha256(db: Db, recovery: Recovery): Promise<string> {
  if (recovery.claimPayload) return requestApprovalPayloadHash(recovery.claimPayload);
  const [company] = await db.select({ name: companies.name }).from(companies).where(eq(companies.id, recovery.companyId));
  return requestApprovalPayloadHash(buildClaimPayload(recovery, company?.name ?? null));
}

/** Deterministic claim draft built only from stored facts; the recovery agent may have written a richer one. */
export async function ensureClaimPayload(db: Db, recovery: Recovery): Promise<Record<string, unknown>> {
  if (recovery.claimPayload) return recovery.claimPayload;
  const [company] = await db.select().from(companies).where(eq(companies.id, recovery.companyId));
  const payload = buildClaimPayload(recovery, company?.name ?? null);
  await db
    .update(recoveries)
    .set({ claimPayload: payload, status: recovery.status === "found" ? "claim_drafted" : recovery.status })
    .where(eq(recoveries.id, recovery.id));
  return payload;
}

/** Records the human approval for file_claim bound to the claim payload. Does not submit anything. */
export async function approveClaim(
  db: Db,
  id: string,
  approvedBy: string,
  opts: { expectedPayloadSha256?: string } = {},
): Promise<Recovery> {
  const rec = await getRecovery(db, id);
  if (!rec) throw new RecoveryServiceError("not_found", `Recovery ${id} not found`);
  if (!["found", "claim_drafted", "awaiting_approval"].includes(rec.status) || rec.approvalId) {
    throw new RecoveryServiceError("not_approvable", "This claim is already approved or submitted.");
  }
  assertReviewedHash(opts.expectedPayloadSha256, await claimPayloadSha256(db, rec), "claim");
  const payload = await ensureClaimPayload(db, rec);
  const approval = await approve(db, { action: "file_claim", subjectId: id, payload, approvedBy });
  const [saved] = await db
    .update(recoveries)
    .set({ approvalId: approval.id, status: "awaiting_approval" })
    .where(and(eq(recoveries.id, id)))
    .returning();
  return saved!;
}
