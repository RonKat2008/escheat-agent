/**
 * Bulk outreach: pre-flight, draft, compose-all, ready-to-approve and approve. Server side only.
 *
 * API SHAPES (for the UI wiring; all routes are session guarded, JSON in and out, nothing here ever sends):
 *
 * POST /api/outreach/bulk-draft            body { channel?: "letter"|"email"|"voice" (default letter),
 *                                                 staleItemIds: uuid[1..50], dryRun?: boolean }   (or ?dryRun=1)
 *   dryRun: writes nothing. 200 { dryRun: true, channel, plan: PlanEntry[], summary: PlanSummary }
 *     PlanEntry = { staleItemId, decision: "will_draft" }
 *               | { staleItemId, decision: "skip", code: DraftSkipCode, message: string,
 *                   detail: { rule?: string, state?: string, opensOn?: "YYYY-MM-DD" } }
 *     DraftSkipCode = "rule_unknown" | "window_not_open" | "already_drafted" | "closed"
 *                   | "missing_owner_address" | "owner_state_unknown" | "not_found"
 *     PlanSummary = { total, willDraft, skipped, byReason: { [code]: count } }
 *   real run: only will_draft items are drafted. 200 { results: BulkDraftResult[],
 *             summary: { drafted, skipped, failed, skippedByReason: { [code]: count } } }
 *     BulkDraftResult = { staleItemId, status: "drafted", outreachId, ready, problems }
 *                     | { staleItemId, status: "skipped", code, reason, detail }
 *                     | { staleItemId, status: "failed", reason }
 *
 * POST /api/outreach/compose-all           body { channel?: ..., outreachIds?: uuid[1..50] }
 *   Composes every draft of the company that has not been composed yet (all of them when outreachIds is omitted,
 *   capped at 50 per call) through the normal draft path and re-runs readiness.
 *   200 { results: ComposeAllResult[], summary: { composed, ready, blocked, failed, remaining } }
 *     ComposeAllResult = { outreachId, staleItemId, status: "composed", ready, problems, warnings, contentSha256 }
 *                      | { outreachId, staleItemId, status: "failed", reason }
 *     contentSha256 is the hash to pass back as expectedContentSha256 when approving what was just composed.
 *
 * POST /api/outreach/bulk-approve          body { channel, approvedBy, items: [{ outreachId, expectedContentSha256, to? }] }
 *   Unchanged gate (human approver, payload hash, per-item re-validation). Failed items now carry an inline reason:
 *   200 { results: BulkApproveResult[], summary: { approved, failed } }
 *     BulkApproveResult = { outreachId, ok: true, approvalId, payloadSha256, status }
 *                       | { outreachId, ok: false, code, error, blockedReason: string, problems: string[] }
 *     blockedReason is display-ready ("Blocked: required notice language for TX is UNKNOWN ..."); problems are the
 *     readiness problems it was built from (empty when the block is not a readiness issue).
 *
 * listReadyToApprove(db, companyId, channel?) -> ReadyDraft[]  (composed, ready, not yet approved), for a "Ready" tab.
 */
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { outreach, type Outreach, type StaleItem } from "@/db/schema";
import { now as clockNow } from "@/lib/clock";
import type { Env } from "@/lib/env";
import type { ComposeDeps } from "@/lib/letters/compose";
import { loadItemContext } from "@/lib/letters/context";
import { tryLoadRules } from "@/lib/rules/load";
import {
  planBulkDraft,
  summarizePlan,
  type DraftSkipCode,
  type PlanEntry,
  type PlanItem,
  type PlanRuleLookup,
  type PlanSummary,
  type SkipDetail,
} from "./bulk-plan";
import { draftOutreach } from "./draft";
import { OutreachNotFoundError } from "./errors";
import { errorInfo } from "./http";
import { approveOutreach } from "./send";
import { outreachContentSha256 } from "./util";

import { BULK_MAX } from "./bulk-limits";

export { BULK_MAX, planBulkDraft, summarizePlan };
export type { DraftSkipCode, PlanEntry, PlanItem, PlanRuleLookup, PlanSummary, SkipDetail };

// ---------- compose state (shared by approve, compose-all and the ready list) ----------

interface ComposeState {
  composed: boolean;
  ready: boolean;
  problems: string[];
  warnings: string[];
}

function composeStateOf(row: Pick<Outreach, "body" | "tracking">): ComposeState {
  const compose = row.tracking?.compose as { readiness?: { ready?: boolean; problems?: string[]; warnings?: string[] } } | undefined;
  const composed = Boolean(row.body) && compose !== undefined;
  const r = compose?.readiness;
  return { composed, ready: composed && r?.ready !== false, problems: r?.problems ?? [], warnings: r?.warnings ?? [] };
}

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
  | { outreachId: string; ok: false; code: string; error: string; blockedReason: string; problems: string[] };

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
    if (!row) return blocked(item.outreachId, "not_found", "Draft not found.", [], null);
    if (row.channel !== args.channel) {
      return blocked(item.outreachId, "wrong_channel", `This is a ${row.channel} draft; a bulk approval covers ${args.channel} drafts only.`, [], null);
    }
    const r = await approveOutreach(db, item.outreachId, args.approvedBy, {
      to: item.to,
      expectedContentSha256: item.expectedContentSha256,
      env: args.env,
    });
    return { outreachId: item.outreachId, ok: true, approvalId: r.approvalId, payloadSha256: r.payloadSha256, status: r.status };
  } catch (err) {
    const { error, extra } = errorInfo(err);
    const code = typeof extra.code === "string" ? extra.code : "error";
    const problems = Array.isArray(extra.problems) ? extra.problems.filter((p): p is string => typeof p === "string") : [];
    return blocked(item.outreachId, code, error, problems, await loadComposeState(db, item.outreachId));
  }
}

async function loadComposeState(db: Db, outreachId: string): Promise<ComposeState | null> {
  const [row] = await db.select({ body: outreach.body, tracking: outreach.tracking }).from(outreach).where(eq(outreach.id, outreachId));
  return row ? composeStateOf(row) : null;
}

/** Display-ready reason a draft could not be approved, built from the readiness problems when there are any. */
function blockedReasonFor(code: string, error: string, problems: string[], state: ComposeState | null): string {
  if (state && !state.composed) return "Blocked: not composed yet. Compose this draft so the required notice language can be checked.";
  if (code === "reviewed_content_changed") return "Blocked: this draft changed after you opened it. Reload and review it again.";
  const all = problems.length > 0 ? problems : (state?.problems ?? []);
  if (all.length > 0) return `Blocked: ${all.join("; ")}`;
  return `Blocked: ${error}`;
}

function blocked(outreachId: string, code: string, error: string, problems: string[], state: ComposeState | null): BulkApproveResult {
  return {
    outreachId,
    ok: false,
    code,
    error,
    blockedReason: blockedReasonFor(code, error, problems, state),
    problems: problems.length > 0 ? problems : (state?.problems ?? []),
  };
}

// ---------- bulk draft ----------

export type BulkDraftResult =
  | { staleItemId: string; status: "drafted"; outreachId: string; ready: boolean; problems: string[] }
  | { staleItemId: string; status: "skipped"; code: DraftSkipCode; reason: string; detail: SkipDetail }
  | { staleItemId: string; status: "failed"; reason: string };

const CLOSED_LABEL: Partial<Record<StaleItem["status"], string>> = {
  resolved_paid: "resolved as paid",
  reported: "already reported",
  remitted: "already remitted",
};
const DRAFT_CONCURRENCY = 4;

/** Why a stale item should not get a new draft, or null when it is eligible. (Used by the close-out planner.) */
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

interface PlanArgs {
  companyId: string;
  channel: Outreach["channel"];
  staleItemIds: string[];
}

/** Rule lookup over the on-disk rule files (or the injected loader), cached per state for one plan. */
function ruleLookup(deps: ComposeDeps): PlanRuleLookup {
  const load = deps.loadRules ?? tryLoadRules;
  const cache = new Map<string, ReturnType<PlanRuleLookup>>();
  return (state) => {
    if (!cache.has(state)) {
      const r = load(state);
      cache.set(state, r ? { requiredLanguage: r.file.dueDiligence.requiredLanguage.value } : null);
    }
    return cache.get(state) ?? null;
  };
}

async function loadPlanItem(db: Db, companyId: string, channel: Outreach["channel"], staleItemId: string): Promise<PlanItem | null> {
  let ctx;
  try {
    ctx = await loadItemContext(db, staleItemId);
  } catch (err) {
    if (err instanceof OutreachNotFoundError) return null;
    throw err;
  }
  if (ctx.stale.companyId !== companyId) return null;
  const existing = await db
    .select({ status: outreach.status })
    .from(outreach)
    .where(and(eq(outreach.staleItemId, staleItemId), eq(outreach.channel, channel)));
  return {
    id: staleItemId,
    status: ctx.stale.status,
    ownerState: ctx.stale.ownerState,
    ddWindowStart: ctx.stale.ddWindowStart,
    hasOwnerAddress: ctx.ownerAddress !== null,
    existing,
  };
}

/**
 * Read-only pre-flight for a bulk draft: loads each item, its existing outreach and the company's "today" (the demo
 * clock), then runs the pure planBulkDraft. Writes nothing. Output order matches `staleItemIds`.
 */
export async function planBulkDraftFromDb(
  db: Db,
  args: PlanArgs,
  deps: ComposeDeps = {},
): Promise<{ plan: PlanEntry[]; summary: PlanSummary }> {
  if (args.staleItemIds.length > BULK_MAX) throw new RangeError(`Bulk draft is limited to ${BULK_MAX} items per request.`);
  const today = await clockNow(db, args.companyId);
  const loaded = await Promise.all(args.staleItemIds.map((id) => loadPlanItem(db, args.companyId, args.channel, id)));
  const found = loaded.filter((x): x is PlanItem => x !== null);
  const planned = planBulkDraft(found, today, ruleLookup(deps), { channel: args.channel });
  const byId = new Map(planned.map((e) => [e.staleItemId, e]));
  const plan = args.staleItemIds.map(
    (id): PlanEntry => byId.get(id) ?? { staleItemId: id, decision: "skip", code: "not_found", message: "Item not found.", detail: {} },
  );
  return { plan, summary: summarizePlan(plan) };
}

/**
 * Draft outreach for many stale items through the EXISTING per-item path (draftOutreach), but only for items the
 * pre-flight says will draft. Drafting is reversible and sends nothing, so it needs no approval. Skipped items carry
 * their reason code and copy; nothing is silently dropped.
 */
export async function bulkDraftOutreach(db: Db, args: PlanArgs, deps: ComposeDeps = {}): Promise<BulkDraftResult[]> {
  const { plan } = await planBulkDraftFromDb(db, args, deps);
  const results = new Array<BulkDraftResult>(plan.length);
  let next = 0;
  const worker = async () => {
    while (next < plan.length) {
      const i = next++;
      const entry = plan[i]!;
      results[i] =
        entry.decision === "skip"
          ? { staleItemId: entry.staleItemId, status: "skipped", code: entry.code, reason: entry.message, detail: entry.detail }
          : await draftOne(db, args.channel, entry.staleItemId, deps);
    }
  };
  await Promise.all(Array.from({ length: Math.min(DRAFT_CONCURRENCY, plan.length) }, worker));
  return results;
}

async function draftOne(db: Db, channel: Outreach["channel"], staleItemId: string, deps: ComposeDeps): Promise<BulkDraftResult> {
  try {
    const r = await draftOutreach(db, staleItemId, channel, deps);
    return { staleItemId, status: "drafted", outreachId: r.outreachId, ready: r.readiness.ready, problems: r.readiness.problems };
  } catch (err) {
    return { staleItemId, status: "failed", reason: errorInfo(err).error };
  }
}

// ---------- compose all ----------

export type ComposeAllResult =
  | { outreachId: string; staleItemId: string; status: "composed"; ready: boolean; problems: string[]; warnings: string[]; contentSha256: string }
  | { outreachId: string; staleItemId: string; status: "failed"; reason: string };

/**
 * Compose every not-yet-composed draft (optionally limited to `outreachIds`) through the normal draft path, then
 * re-read readiness. Only rows of `companyId` in a draft state are touched; approved drafts are never recomposed
 * here. `remaining` counts uncomposed drafts left over after the BULK_MAX cap.
 */
export async function composeAllDrafts(
  db: Db,
  args: { companyId: string; channel: Outreach["channel"]; outreachIds?: string[] },
  deps: ComposeDeps = {},
): Promise<{ results: ComposeAllResult[]; remaining: number }> {
  if (args.outreachIds && args.outreachIds.length > BULK_MAX) throw new RangeError(`Compose all is limited to ${BULK_MAX} drafts per request.`);
  const rows = await db
    .select()
    .from(outreach)
    .where(
      and(
        eq(outreach.companyId, args.companyId),
        eq(outreach.channel, args.channel),
        inArray(outreach.status, ["draft", "awaiting_approval"]),
        ...(args.outreachIds ? [inArray(outreach.id, args.outreachIds)] : []),
      ),
    );
  const todo = rows.filter((r) => !composeStateOf(r).composed);
  const batch = todo.slice(0, BULK_MAX);
  const results = new Array<ComposeAllResult>(batch.length);
  let next = 0;
  const worker = async () => {
    while (next < batch.length) {
      const i = next++;
      results[i] = await composeOne(db, batch[i]!, deps);
    }
  };
  await Promise.all(Array.from({ length: Math.min(DRAFT_CONCURRENCY, batch.length) }, worker));
  return { results, remaining: todo.length - batch.length };
}

async function composeOne(db: Db, row: Outreach, deps: ComposeDeps): Promise<ComposeAllResult> {
  try {
    await draftOutreach(db, row.staleItemId, row.channel, deps);
    const [fresh] = await db.select().from(outreach).where(eq(outreach.id, row.id));
    if (!fresh) return { outreachId: row.id, staleItemId: row.staleItemId, status: "failed", reason: "Draft disappeared while composing." };
    const state = composeStateOf(fresh);
    return {
      outreachId: row.id,
      staleItemId: row.staleItemId,
      status: "composed",
      ready: state.ready,
      problems: state.problems,
      warnings: state.warnings,
      contentSha256: outreachContentSha256(fresh),
    };
  } catch (err) {
    return { outreachId: row.id, staleItemId: row.staleItemId, status: "failed", reason: errorInfo(err).error };
  }
}

// ---------- ready to approve ----------

export interface ReadyDraft {
  outreachId: string;
  staleItemId: string;
  channel: Outreach["channel"];
  subject: string | null;
  /** Pass back as expectedContentSha256 when approving. */
  contentSha256: string;
  warnings: string[];
}

/** Drafts that are composed, ready and not yet approved (the "Ready to approve" list). Oldest first. */
export async function listReadyToApprove(db: Db, companyId: string, channel?: Outreach["channel"]): Promise<ReadyDraft[]> {
  const rows = await db
    .select()
    .from(outreach)
    .where(
      and(
        eq(outreach.companyId, companyId),
        inArray(outreach.status, ["draft", "awaiting_approval"]),
        ...(channel ? [eq(outreach.channel, channel)] : []),
      ),
    );
  return rows
    .filter((r) => composeStateOf(r).ready)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map((r) => ({
      outreachId: r.id,
      staleItemId: r.staleItemId,
      channel: r.channel,
      subject: r.subject,
      contentSha256: outreachContentSha256(r),
      warnings: composeStateOf(r).warnings,
    }));
}
