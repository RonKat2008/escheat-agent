import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { ledgerItems, outreach, staleItems, type Outreach, type StaleItem } from "@/db/schema";
import { composeNotice, type ComposeDeps } from "@/lib/letters/compose";
import { itemRowsByOutreach } from "@/lib/letters/notice-items";
import { groupNotices, needsConsolidation, noticeKey, type NoticeCandidate, type NoticeGroup } from "./consolidate";
import { errorInfo } from "./http";
import { EDITABLE_STATUSES } from "./util";

/**
 * One notice per owner, DB side: finds the open letters that should be one notice (same owner, same state) and
 * composes each group into a single letter through composeNotice. Drafting only: nothing is approved or sent.
 */

/** Items that no longer need a notice never join one. */
const CLOSED: readonly StaleItem["status"][] = ["resolved_paid", "reported", "remitted", "to_report"];

export interface LetterCandidates {
  candidates: NoticeCandidate[];
  /** Outreach id -> stale item ids its letter lists today, in letter order. */
  coverage: Map<string, string[]>;
  rows: Map<string, Outreach>;
}

/** Every open letter (draft, awaiting approval, approved) of the company, one candidate per item it lists. */
export async function loadLetterCandidates(db: Db, companyId: string): Promise<LetterCandidates> {
  const rows = await db
    .select()
    .from(outreach)
    .where(and(eq(outreach.companyId, companyId), eq(outreach.channel, "letter"), inArray(outreach.status, [...EDITABLE_STATUSES])));
  const itemRows = await itemRowsByOutreach(db, rows.map((r) => r.id));
  const coverage = new Map(rows.map((r) => [r.id, itemRows.get(r.id) ?? [r.staleItemId]]));
  const staleIds = [...new Set([...coverage.values()].flat())];
  const items = staleIds.length
    ? await db
        .select({ s: staleItems, l: ledgerItems })
        .from(staleItems)
        .innerJoin(ledgerItems, eq(ledgerItems.id, staleItems.ledgerItemId))
        .where(inArray(staleItems.id, staleIds))
    : [];
  const byId = new Map(items.map((x) => [x.s.id, x]));
  const candidates: NoticeCandidate[] = [];
  for (const r of rows) {
    const covered = coverage.get(r.id)!;
    for (const sid of covered) {
      const it = byId.get(sid);
      if (!it || CLOSED.includes(it.s.status)) continue;
      candidates.push({
        outreachId: r.id,
        staleItemId: sid,
        ownerPayeeId: it.s.ownerPayeeId ?? it.l.payeeId,
        state: it.s.ownerState,
        referenceNumber: it.l.referenceNumber,
        issueDate: it.l.issueDate,
        amountCents: it.s.amountCents,
        itemCount: covered.length,
      });
    }
  }
  return { candidates, coverage, rows: new Map(rows.map((r) => [r.id, r])) };
}

/** Open letters that would be combined by Compose all, as notice groups. */
export async function pendingConsolidation(db: Db, companyId: string): Promise<NoticeGroup[]> {
  const { candidates, coverage } = await loadLetterCandidates(db, companyId);
  return groupNotices(candidates).filter((g) => needsConsolidation(g, coverage));
}

export type ConsolidateResult =
  | { outreachId: string; staleItemId: string; status: "composed"; itemCount: number; totalCents: number; absorbed: string[] }
  | { outreachId: string; staleItemId: string; status: "failed"; reason: string };

/** The lead stale item first (the letter row lives on it), then the rest in letter order. */
function composeOrder(group: NoticeGroup, lead: Outreach | undefined): string[] {
  const ids = group.items.map((i) => i.staleItemId);
  const leadItem = lead && ids.includes(lead.staleItemId) ? lead.staleItemId : ids[0]!;
  return [leadItem, ...ids.filter((id) => id !== leadItem)];
}

/** Compose every owner+state group of open letters into one notice. Groups are independent: one failure stays local. */
export async function consolidateLetters(
  db: Db,
  companyId: string,
  deps: ComposeDeps = {},
  opts: { onlyOutreachIds?: readonly string[] } = {},
): Promise<ConsolidateResult[]> {
  const { candidates, coverage, rows } = await loadLetterCandidates(db, companyId);
  const only = opts.onlyOutreachIds ? new Set(opts.onlyOutreachIds) : null;
  const groups = groupNotices(candidates)
    .filter((g) => needsConsolidation(g, coverage))
    .filter((g) => !only || g.items.some((i) => only.has(i.outreachId)));
  const results: ConsolidateResult[] = [];
  for (const group of groups) {
    const lead = rows.get(group.leadOutreachId);
    const ids = composeOrder(group, lead);
    try {
      const r = await composeNotice(db, ids, deps);
      results.push({
        outreachId: r.outreachId,
        staleItemId: ids[0]!,
        status: "composed",
        itemCount: group.items.length,
        totalCents: group.totalCents,
        absorbed: group.items.map((i) => i.outreachId).filter((id, i, all) => id !== r.outreachId && all.indexOf(id) === i),
      });
    } catch (err) {
      results.push({ outreachId: group.leadOutreachId, staleItemId: ids[0]!, status: "failed", reason: errorInfo(err).error });
    }
  }
  return results;
}

/**
 * Server-side guard for approving a letter: refuses while another open letter to the same owner in the same state
 * exists, so an owner never gets two notices. The message names the fix (Compose all combines them).
 */
export async function consolidationBlock(db: Db, row: Outreach): Promise<string | null> {
  if (row.channel !== "letter") return null;
  const { candidates, coverage } = await loadLetterCandidates(db, row.companyId);
  const mine = candidates.find((c) => c.outreachId === row.id);
  if (!mine) return null;
  const key = noticeKey(mine);
  const group = groupNotices(candidates).find((g) => g.key === key);
  if (!group || !needsConsolidation(group, coverage)) return null;
  const others = new Set(group.items.map((i) => i.outreachId).filter((id) => id !== row.id)).size;
  return others > 0
    ? `another open letter to this owner in ${group.state} must be combined into one notice first; run Compose all`
    : `this owner's notice must list every open item in ${group.state}; run Compose all`;
}
