/**
 * One notice per owner (dogfood round 3, opportunity #4; R2-04, R3-13). Pure: no DB, no clock, no model.
 *
 * A holder sends ONE due-diligence notice per owner, listing every reportable property. Letters are grouped by owner
 * (payee id) AND owner state: states have different notice rules and windows, so two states never share a letter.
 * An item with no known owner or no known state is never merged with anything; it stays a letter of its own.
 */

/** One open letter draft (or one item it covers) that may join an owner's notice. */
export interface NoticeCandidate {
  outreachId: string;
  staleItemId: string;
  /** Owner payee id (stale item owner, else the ledger payee). Null: unknown owner, never merged. */
  ownerPayeeId: string | null;
  /** Owner state from the rules engine. Null: unknown state, never merged. */
  state: string | null;
  referenceNumber: string | null;
  /** ISO date the item was issued. */
  issueDate: string;
  /** Integer cents. */
  amountCents: number;
  /** How many items the candidate's letter already lists (1 for a plain single-item letter). */
  itemCount: number;
}

export interface NoticeGroup {
  /** `owner|state`, or `solo:<staleItemId>` when the item cannot be merged. */
  key: string;
  ownerPayeeId: string | null;
  state: string | null;
  /** The letter row the notice lives on: the one already covering the most items, then the earliest item's. */
  leadOutreachId: string;
  /** Items in letter order (issue date, then check number). Unique by stale item. */
  items: NoticeCandidate[];
  /** Integer cents. */
  totalCents: number;
}

export function noticeKey(c: Pick<NoticeCandidate, "ownerPayeeId" | "state" | "staleItemId">): string {
  const state = c.state?.trim().toUpperCase();
  return c.ownerPayeeId && state ? `${c.ownerPayeeId}|${state}` : `solo:${c.staleItemId}`;
}

/** Letter order: oldest first, then by check number, then by id so the order never depends on input order. */
export function compareNoticeItems(a: NoticeCandidate, b: NoticeCandidate): number {
  if (a.issueDate !== b.issueDate) return a.issueDate < b.issueDate ? -1 : 1;
  const ar = a.referenceNumber ?? "";
  const br = b.referenceNumber ?? "";
  if (ar !== br) return ar.localeCompare(br, "en", { numeric: true });
  return a.staleItemId < b.staleItemId ? -1 : a.staleItemId > b.staleItemId ? 1 : 0;
}

/** Sum of integer cents. Throws on a non-integer so a float never reaches a letter or a payload. */
export function totalCents(items: readonly Pick<NoticeCandidate, "amountCents">[]): number {
  let sum = 0;
  for (const i of items) {
    if (!Number.isSafeInteger(i.amountCents)) throw new RangeError(`amount must be integer cents, got ${i.amountCents}`);
    sum += i.amountCents;
  }
  return sum;
}

function pickLead(items: readonly NoticeCandidate[]): string {
  const ranked = [...items].sort((a, b) => b.itemCount - a.itemCount || compareNoticeItems(a, b));
  return ranked[0]!.outreachId;
}

/**
 * Groups candidates into notices. Same owner + same state merge; anything else stays apart. A stale item listed
 * twice (for example by two open letters) appears once. Group order follows each group's first appearance.
 */
export function groupNotices(candidates: readonly NoticeCandidate[]): NoticeGroup[] {
  const order: string[] = [];
  const byKey = new Map<string, Map<string, NoticeCandidate>>();
  for (const c of candidates) {
    const key = noticeKey(c);
    let items = byKey.get(key);
    if (!items) {
      items = new Map();
      byKey.set(key, items);
      order.push(key);
    }
    const prev = items.get(c.staleItemId);
    // Keep the copy on the letter that already covers more items, so the lead stays stable.
    if (!prev || c.itemCount > prev.itemCount) items.set(c.staleItemId, c);
  }
  return order.map((key) => {
    const items = [...byKey.get(key)!.values()].sort(compareNoticeItems);
    const first = items[0]!;
    return {
      key,
      ownerPayeeId: first.ownerPayeeId,
      state: first.state?.trim().toUpperCase() ?? null,
      leadOutreachId: pickLead(items),
      items,
      totalCents: totalCents(items),
    };
  });
}

/** The letter rows a group replaces: every candidate row other than the lead. */
export function absorbedOutreachIds(group: NoticeGroup): string[] {
  return [...new Set(group.items.map((i) => i.outreachId).filter((id) => id !== group.leadOutreachId))];
}

/** "check" / "checks" when every item is a check, else "item" / "items". */
export function itemNoun(count: number, allChecks: boolean): string {
  const noun = allChecks ? "check" : "item";
  return count === 1 ? noun : `${noun}s`;
}

/**
 * Whether a group still needs composing into one notice: it covers more than one item and either another letter row
 * would be absorbed or the lead letter does not list exactly the group's items yet. `coverage` maps an outreach id to
 * the stale item ids its letter lists today.
 */
export function needsConsolidation(group: NoticeGroup, coverage: ReadonlyMap<string, readonly string[]>): boolean {
  if (group.items.length < 2) return false;
  if (absorbedOutreachIds(group).length > 0) return true;
  const listed = coverage.get(group.leadOutreachId) ?? [];
  const want = group.items.map((i) => i.staleItemId);
  return listed.length !== want.length || want.some((id, i) => listed[i] !== id);
}

/** Groups that Compose all would (re)compose into one notice, in group order. */
export function planConsolidation(candidates: readonly NoticeCandidate[], coverage: ReadonlyMap<string, readonly string[]>): NoticeGroup[] {
  return groupNotices(candidates).filter((g) => needsConsolidation(g, coverage));
}
