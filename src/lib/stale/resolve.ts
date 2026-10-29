import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { staleItems, type StaleItem } from "@/db/schema";
import { approve, withApproval } from "@/lib/approvals";
import { now as clockNow } from "@/lib/clock";

/**
 * The ONLY in-app path to resolved_paid (security review H2); the other is a matched bank clear. Public owner
 * links record intent only. The human click is written to the approvals table (mark_resolved_paid, bound to the
 * item and the status the reviewer saw) and consumed to apply the change.
 */

export class ResolveError extends Error {
  constructor(
    public readonly code: "not_found" | "status_changed" | "terminal",
    message: string,
  ) {
    super(message);
    this.name = "ResolveError";
  }
}

const TERMINAL: StaleItem["status"][] = ["resolved_paid", "remitted"];

export async function markResolvedPaid(
  db: Db,
  input: { staleItemId: string; expectedStatus: StaleItem["status"]; by: string },
  now: Date = new Date(),
): Promise<{ status: "resolved_paid"; approvalId: string }> {
  if (!input.by.trim()) throw new Error("markResolvedPaid: approver is required");
  const [item] = await db.select().from(staleItems).where(eq(staleItems.id, input.staleItemId));
  if (!item) throw new ResolveError("not_found", "Item not found.");
  if (TERMINAL.includes(item.status)) throw new ResolveError("terminal", `This item is already ${item.status.replace("_", " ")}.`);
  if (item.status !== input.expectedStatus) {
    throw new ResolveError("status_changed", "This item's status changed since you opened it. Reload and review it again.");
  }
  const payload = { staleItemId: item.id, fromStatus: item.status, amountCents: item.amountCents };
  // Business date of the resolution comes from the company clock (demo date in demo mode); `now` stays the
  // wall-clock time used for the approval record and its TTL.
  const resolvedOn = await clockNow(db, item.companyId);
  const approval = await approve(db, { action: "mark_resolved_paid", subjectId: item.id, payload, approvedBy: input.by }, now);
  await withApproval(db, { action: "mark_resolved_paid", subjectId: item.id, payload }, async () => {
    await db
      .update(staleItems)
      .set({
        status: "resolved_paid",
        resolvedAt: new Date(`${resolvedOn}T00:00:00.000Z`),
        classification: {
          ...((item.classification ?? {}) as Record<string, unknown>),
          resolution: { by: input.by, at: resolvedOn, recordedAt: now.toISOString(), approvalId: approval.id, fromStatus: item.status },
        },
      })
      .where(eq(staleItems.id, item.id));
  });
  return { status: "resolved_paid", approvalId: approval.id };
}
