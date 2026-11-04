import { and, asc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { approvals } from "@/db/schema";

export interface DiscardRecord {
  outreachId: string;
  by: string | null;
  reason: string | null;
  at: string | null;
  /** First 12 hex chars of the sha256 of the discarded draft. */
  payloadHash: string;
}

/** Audit rows for drafts a person discarded, for the given outreach ids (oldest first). */
export async function listDiscards(db: Db, outreachIds: readonly string[]): Promise<DiscardRecord[]> {
  if (outreachIds.length === 0) return [];
  const rows = await db
    .select()
    .from(approvals)
    .where(and(eq(approvals.action, "discard_draft"), inArray(approvals.subjectId, [...outreachIds])))
    .orderBy(asc(approvals.createdAt));
  return rows.map((r) => ({
    outreachId: r.subjectId,
    by: r.approvedBy,
    reason: r.reason,
    at: r.approvedAt?.toISOString() ?? null,
    payloadHash: r.payloadSha256.slice(0, 12),
  }));
}
