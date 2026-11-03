import { and, asc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { ledgerItems, outreach, outreachItems, staleItems, type Outreach } from "@/db/schema";
import { EDITABLE_STATUSES } from "@/lib/outreach/util";

/** One property listed in a notice, read live from the stale item and its ledger row. */
export interface NoticeItem {
  staleItemId: string;
  referenceNumber: string | null;
  issueDate: string;
  /** Integer cents (the stale item's current amount). */
  amountCents: number;
  propertyType: string;
}

/**
 * Every item an outreach row covers, in letter order. A consolidated letter lists its outreach_items rows; any other
 * row (single-item letters, emails, calls) covers just its own stale item.
 */
export async function loadNoticeItems(db: Db, row: Pick<Outreach, "id" | "staleItemId">): Promise<NoticeItem[]> {
  const joined = await db
    .select({ s: staleItems, l: ledgerItems })
    .from(outreachItems)
    .innerJoin(staleItems, eq(staleItems.id, outreachItems.staleItemId))
    .innerJoin(ledgerItems, eq(ledgerItems.id, staleItems.ledgerItemId))
    .where(eq(outreachItems.outreachId, row.id))
    .orderBy(asc(outreachItems.position));
  if (joined.length > 0) return joined.map(({ s, l }) => toNoticeItem(s, l));
  const [single] = await db
    .select({ s: staleItems, l: ledgerItems })
    .from(staleItems)
    .innerJoin(ledgerItems, eq(ledgerItems.id, staleItems.ledgerItemId))
    .where(eq(staleItems.id, row.staleItemId));
  return single ? [toNoticeItem(single.s, single.l)] : [];
}

function toNoticeItem(s: typeof staleItems.$inferSelect, l: typeof ledgerItems.$inferSelect): NoticeItem {
  return {
    staleItemId: s.id,
    referenceNumber: l.referenceNumber,
    issueDate: l.issueDate,
    amountCents: s.amountCents,
    propertyType: s.propertyType,
  };
}

/** Stale item ids an outreach row covers (the lead item first when it has no item rows). */
export async function coveredStaleItemIds(db: Db, row: Pick<Outreach, "id" | "staleItemId">): Promise<string[]> {
  const rows = await db
    .select({ staleItemId: outreachItems.staleItemId })
    .from(outreachItems)
    .where(eq(outreachItems.outreachId, row.id))
    .orderBy(asc(outreachItems.position));
  return rows.length > 0 ? rows.map((r) => r.staleItemId) : [row.staleItemId];
}

/** Item rows per outreach id, for list views. Rows without item rows are absent from the map. */
export async function itemRowsByOutreach(db: Db, outreachIds: readonly string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (outreachIds.length === 0) return out;
  const rows = await db
    .select({ outreachId: outreachItems.outreachId, staleItemId: outreachItems.staleItemId })
    .from(outreachItems)
    .where(inArray(outreachItems.outreachId, [...outreachIds]))
    .orderBy(asc(outreachItems.position));
  for (const r of rows) out.set(r.outreachId, [...(out.get(r.outreachId) ?? []), r.staleItemId]);
  return out;
}

/**
 * The open (draft, awaiting approval or approved) consolidated letter that lists this stale item, if any. Used so a
 * re-draft of any item in an owner's notice recomposes that one notice instead of starting a second letter.
 */
export async function findOpenNoticeCovering(db: Db, staleItemId: string): Promise<Outreach | null> {
  const rows = await db
    .select({ o: outreach })
    .from(outreachItems)
    .innerJoin(outreach, eq(outreach.id, outreachItems.outreachId))
    .where(and(eq(outreachItems.staleItemId, staleItemId), eq(outreach.channel, "letter"), inArray(outreach.status, [...EDITABLE_STATUSES])));
  return rows[0]?.o ?? null;
}

/** Replace a letter's item list (positions follow the given order). An empty list clears it. */
export async function setNoticeItems(db: Db, outreachId: string, items: readonly Pick<NoticeItem, "staleItemId" | "amountCents">[]): Promise<void> {
  await db.delete(outreachItems).where(eq(outreachItems.outreachId, outreachId));
  if (items.length === 0) return;
  await db.insert(outreachItems).values(items.map((i, position) => ({ outreachId, staleItemId: i.staleItemId, amountCents: i.amountCents, position })));
}
