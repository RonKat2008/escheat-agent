import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { outreach, staleItems, type Outreach, type StaleItem } from "@/db/schema";
import type { Env } from "@/lib/env";
import type { ComposeDeps } from "@/lib/letters/compose";
import { draftOutreach } from "./draft";
import { errorInfo } from "./http";
import { approveOutreach } from "./send";

import { BULK_MAX } from "./bulk-limits";

export { BULK_MAX };

// ---------- bulk approve (records approvals only; never sends) ----------

export interface BulkApproveItem {
  outreachId: string;
  /** outreachContentSha256 of the draft the reviewer saw (same contract as the single approve endpoint). */
  expectedContentSha256: string;
  /** Recipient for email/voice; ignored for letters. */
  to?: string;
}

export type BulkApproveResult =
  | { outreachId: string; ok: true; approvalId: string; payloadSha256: string; status: string }
  | { outreachId: string; ok: false; code: string; error: string };

interface ApproveArgs {
  companyId: string;
  channel: Outreach["channel"];
  approvedBy: string;
  env?: Env;
}

/**
 * Approve many drafts of ONE channel. Each item goes through the exact single-item path (approveOutreach):
 * its own re-validation, its own payload sha256 and its own approval row. A failure on one item never affects
 * another. Only rows of `companyId` are visible; anything else is reported as not found. Nothing is sent here.
 */
export async function bulkApproveOutreach(db: Db, args: ApproveArgs & { items: BulkApproveItem[] }): Promise<BulkApproveResult[]> {
  if (args.items.length > BULK_MAX) throw new RangeError(`Bulk approve is limited to ${BULK_MAX} items per request.`);
  const results: BulkApproveResult[] = [];
  for (const item of args.items) {
    results.push(await approveOne(db, args, item));
  }
  return results;
}

async function approveOne(db: Db, args: ApproveArgs, item: BulkApproveItem): Promise<BulkApproveResult> {
  try {
    const [row] = await db
      .select({ id: outreach.id, channel: outreach.channel })
      .from(outreach)
      .where(and(eq(outreach.id, item.outreachId), eq(outreach.companyId, args.companyId)));
    if (!row) return { outreachId: item.outreachId, ok: false, code: "not_found", error: "Draft not found." };
    if (row.channel !== args.channel) {
      return {
        outreachId: item.outreachId,
        ok: false,
        code: "wrong_channel",
        error: `This is a ${row.channel} draft; a bulk approval covers ${args.channel} drafts only.`,
      };
    }
    const r = await approveOutreach(db, item.outreachId, args.approvedBy, {
      to: item.to,
      expectedContentSha256: item.expectedContentSha256,
      env: args.env,
    });
    return { outreachId: item.outreachId, ok: true, approvalId: r.approvalId, payloadSha256: r.payloadSha256, status: r.status };
  } catch (err) {
    const { error, extra } = errorInfo(err);
    return { outreachId: item.outreachId, ok: false, code: typeof extra.code === "string" ? extra.code : "error", error };
  }
}

// ---------- bulk draft ----------

export type BulkDraftResult =
  | { staleItemId: string; status: "drafted"; outreachId: string; ready: boolean; problems: string[] }
  | { staleItemId: string; status: "skipped"; reason: string }
  | { staleItemId: string; status: "failed"; reason: string };

const CLOSED_LABEL: Partial<Record<StaleItem["status"], string>> = {
  resolved_paid: "resolved as paid",
  reported: "already reported",
  remitted: "already remitted",
};
const DRAFT_CONCURRENCY = 4;

/** Why a stale item should not get a new draft, or null when it is eligible. */
export function draftIneligibleReason(
  item: Pick<StaleItem, "status" | "ownerState">,
  existing: Pick<Outreach, "status">[],
  channel: Outreach["channel"],
): string | null {
  const closed = CLOSED_LABEL[item.status];
  if (closed) return `Item is ${closed}; no outreach needed.`;
  if (item.status === "needs_rule") return "No usable rule for this state yet, so the notice cannot be prepared.";
  if (item.status === "to_report") return "Due-diligence window has passed; the item is in the report queue.";
  if (!item.ownerState) return "Owner state is unknown, so the required notice language cannot be chosen.";
  if (existing.some((o) => o.status === "draft" || o.status === "awaiting_approval")) {
    return `A ${channel} draft is already waiting in Approvals.`;
  }
  if (existing.some((o) => o.status === "approved")) {
    return `A ${channel} is already approved. Recompose it from Approvals if it must change.`;
  }
  if (existing.length > 0) return `A ${channel} was already sent or closed for this item.`;
  return null;
}

/**
 * Draft outreach for many stale items through the EXISTING per-item path (draftOutreach). Drafting is reversible and
 * sends nothing, so it needs no approval. Ineligible items are skipped with a reason, never silently dropped.
 */
export async function bulkDraftOutreach(
  db: Db,
  args: { companyId: string; channel: Outreach["channel"]; staleItemIds: string[] },
  deps: ComposeDeps = {},
): Promise<BulkDraftResult[]> {
  if (args.staleItemIds.length > BULK_MAX) throw new RangeError(`Bulk draft is limited to ${BULK_MAX} items per request.`);
  const results = new Array<BulkDraftResult>(args.staleItemIds.length);
  let next = 0;
  const worker = async () => {
    while (next < args.staleItemIds.length) {
      const i = next++;
      results[i] = await draftOne(db, args, args.staleItemIds[i]!, deps);
    }
  };
  await Promise.all(Array.from({ length: Math.min(DRAFT_CONCURRENCY, args.staleItemIds.length) }, worker));
  return results;
}

async function draftOne(
  db: Db,
  args: { companyId: string; channel: Outreach["channel"] },
  staleItemId: string,
  deps: ComposeDeps,
): Promise<BulkDraftResult> {
  try {
    const [item] = await db
      .select()
      .from(staleItems)
      .where(and(eq(staleItems.id, staleItemId), eq(staleItems.companyId, args.companyId)));
    if (!item) return { staleItemId, status: "skipped", reason: "Item not found." };
    const existing = await db
      .select({ status: outreach.status })
      .from(outreach)
      .where(and(eq(outreach.staleItemId, staleItemId), eq(outreach.channel, args.channel)));
    const reason = draftIneligibleReason(item, existing, args.channel);
    if (reason) return { staleItemId, status: "skipped", reason };
    const r = await draftOutreach(db, staleItemId, args.channel, deps);
    return { staleItemId, status: "drafted", outreachId: r.outreachId, ready: r.readiness.ready, problems: r.readiness.problems };
  } catch (err) {
    return { staleItemId, status: "failed", reason: errorInfo(err).error };
  }
}
