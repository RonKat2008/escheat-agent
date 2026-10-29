import { and, eq, isNotNull, isNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import { approvals, type Approval, type ApprovalAction } from "@/db/schema";
import { canonicalJson, sha256Hex } from "@/lib/crypto";

/**
 * Server-side human-approval gate (HARD RULE 5). An approval binds to the exact
 * payload hash; editing the payload after approval invalidates it. Single use.
 */

export class ApprovalRequiredError extends Error {
  constructor(
    public readonly action: ApprovalAction,
    public readonly subjectId: string,
    public readonly reason: "none" | "payload_changed" | "consumed" = "none",
  ) {
    super(
      `Human approval required for ${action} on ${subjectId} (${reason === "none" ? "no approval on file" : reason.replace("_", " ")}).`,
    );
    this.name = "ApprovalRequiredError";
  }
}

export class ApprovalAlreadyConsumedError extends Error {
  constructor(public readonly approvalId: string) {
    super(`Approval ${approvalId} was already consumed or does not exist.`);
    this.name = "ApprovalAlreadyConsumedError";
  }
}

export interface ApprovalRef {
  action: ApprovalAction;
  subjectId: string;
  payload: unknown;
}

export function requestApprovalPayloadHash(payload: unknown): string {
  return sha256Hex(canonicalJson(payload));
}

export async function approve(
  db: Db,
  args: ApprovalRef & { approvedBy: string },
  now: Date = new Date(),
): Promise<Approval> {
  if (!args.approvedBy.trim()) throw new Error("approve: approvedBy is required");
  const [row] = await db
    .insert(approvals)
    .values({
      action: args.action,
      subjectId: args.subjectId,
      payloadSha256: requestApprovalPayloadHash(args.payload),
      approvedBy: args.approvedBy,
      approvedAt: now,
    })
    .returning();
  return row!;
}

/** Returns the usable approval for the CURRENT payload or throws ApprovalRequiredError. */
export async function assertApproved(db: Db, args: ApprovalRef): Promise<Approval> {
  const hash = requestApprovalPayloadHash(args.payload);
  const rows = await db
    .select()
    .from(approvals)
    .where(
      and(
        eq(approvals.action, args.action),
        eq(approvals.subjectId, args.subjectId),
        isNotNull(approvals.approvedAt),
      ),
    );
  if (rows.length === 0) throw new ApprovalRequiredError(args.action, args.subjectId, "none");
  const matching = rows.filter((r) => r.payloadSha256 === hash);
  if (matching.length === 0) {
    throw new ApprovalRequiredError(args.action, args.subjectId, "payload_changed");
  }
  const usable = matching.find((r) => r.consumedAt === null);
  if (!usable) throw new ApprovalRequiredError(args.action, args.subjectId, "consumed");
  return usable;
}

/** Atomic single-use consume: the second caller gets ApprovalAlreadyConsumedError. */
export async function consumeApproval(
  db: Db,
  approvalId: string,
  now: Date = new Date(),
): Promise<Approval> {
  const [row] = await db
    .update(approvals)
    .set({ consumedAt: now })
    .where(and(eq(approvals.id, approvalId), isNull(approvals.consumedAt), isNotNull(approvals.approvedAt)))
    .returning();
  if (!row) throw new ApprovalAlreadyConsumedError(approvalId);
  return row;
}

/**
 * assert -> execute -> consume. The approval is claimed atomically BEFORE the
 * executor runs so two concurrent callers can never both perform the irreversible
 * action; if the executor throws the claim is released (approval stays usable)
 * and the error is rethrown. A process crash mid-executor leaves it consumed
 * (fail-safe against double-sends).
 */
export async function withApproval<T>(
  db: Db,
  args: ApprovalRef,
  executor: (approval: Approval) => Promise<T>,
): Promise<T> {
  const approval = await assertApproved(db, args);
  const claimed = await consumeApproval(db, approval.id);
  try {
    return await executor(claimed);
  } catch (err) {
    await db
      .update(approvals)
      .set({ consumedAt: null })
      .where(eq(approvals.id, approval.id));
    throw err;
  }
}
