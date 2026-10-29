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
    public readonly reason: "none" | "payload_changed" | "consumed" | "expired" = "none",
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

/** The content the reviewer saw is no longer the current content (approve-time TOCTOU, security review M2). */
export class ReviewedContentChangedError extends Error {
  readonly code = "reviewed_content_changed";
  constructor(what: string) {
    super(`The ${what} changed after you opened it. Reload it, review the new version, and approve again.`);
    this.name = "ReviewedContentChangedError";
  }
}

/** Throws when the hash the reviewer saw differs from the current one. `expected === undefined` skips (service callers). */
export function assertReviewedHash(expected: string | undefined, actual: string, what: string): void {
  if (expected !== undefined && expected !== actual) throw new ReviewedContentChangedError(what);
}

/**
 * The executor ran past the point of no return and then failed (or its outcome is unknown). The approval stays
 * CONSUMED so nothing can be sent twice; a human must reconcile with the provider (security review M4).
 */
export class OutcomeUnknownError extends Error {
  constructor(
    public readonly approvalId: string,
    public readonly action: ApprovalAction,
    public readonly subjectId: string,
    cause: unknown,
  ) {
    super(
      `${action} on ${subjectId}: the irreversible step may have happened but its outcome is unknown (${cause instanceof Error ? cause.message : String(cause)}). The approval stays consumed; reconcile manually before retrying.`,
      { cause },
    );
    this.name = "OutcomeUnknownError";
  }
}

export interface ExecutorControl {
  /** Call immediately BEFORE the request/click that cannot be undone. */
  markAttempted(): void;
}

export interface WithApprovalOptions {
  /** Called when the outcome is unknown, so the caller can flag the item for manual reconciliation. */
  onUnknownOutcome?: (err: unknown, approval: Approval) => Promise<void>;
}

const DEFAULT_APPROVAL_TTL_HOURS = 24;

/** How long an in-app approval stays usable (L5). APPROVAL_TTL_HOURS, default 24. */
export function approvalTtlMs(): number {
  const h = Number(process.env.APPROVAL_TTL_HOURS);
  return (Number.isFinite(h) && h > 0 ? h : DEFAULT_APPROVAL_TTL_HOURS) * 3600_000;
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
export async function assertApproved(db: Db, args: ApprovalRef, now: Date = new Date()): Promise<Approval> {
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
  const unconsumed = matching.filter((r) => r.consumedAt === null);
  if (unconsumed.length === 0) throw new ApprovalRequiredError(args.action, args.subjectId, "consumed");
  const ttl = approvalTtlMs();
  const usable = unconsumed.find((r) => r.approvedAt && now.getTime() - r.approvedAt.getTime() <= ttl);
  if (!usable) throw new ApprovalRequiredError(args.action, args.subjectId, "expired");
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
 * assert -> execute -> consume. The approval is claimed atomically BEFORE the executor runs so two concurrent
 * callers can never both perform the irreversible action.
 *
 * If the executor throws, the claim is released (approval stays usable) ONLY when the failure is known to be
 * pre-side-effect: the executor never called ctl.markAttempted(), or the error carries
 * `sideEffectNotPerformed === true` (e.g. a provider 4xx proving nothing happened). Any other failure after
 * markAttempted() leaves the approval consumed and throws OutcomeUnknownError (M4). A process crash mid-executor
 * also leaves it consumed (fail-safe against double-sends).
 */
export async function withApproval<T>(
  db: Db,
  args: ApprovalRef,
  executor: (approval: Approval, ctl: ExecutorControl) => Promise<T>,
  opts: WithApprovalOptions = {},
): Promise<T> {
  const approval = await assertApproved(db, args);
  const claimed = await consumeApproval(db, approval.id);
  let attempted = false;
  try {
    return await executor(claimed, { markAttempted: () => void (attempted = true) });
  } catch (err) {
    const notPerformed = (err as { sideEffectNotPerformed?: boolean } | null)?.sideEffectNotPerformed === true;
    if (!attempted || notPerformed) {
      await db.update(approvals).set({ consumedAt: null }).where(eq(approvals.id, approval.id));
      throw err;
    }
    try {
      await opts.onUnknownOutcome?.(err, claimed);
    } catch (hookErr) {
      console.error("[approvals] onUnknownOutcome hook failed:", hookErr);
    }
    throw new OutcomeUnknownError(approval.id, args.action, args.subjectId, err);
  }
}
