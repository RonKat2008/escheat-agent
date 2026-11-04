/**
 * R5-09: an item's status moves the moment a person acts (a letter goes out, an owner replies), not only when the
 * demo clock moves. One rule, shared with the clock Reset: the person's action sets a floor (a sent letter => dd_sent,
 * an owner reply => owner_responded) and the pure timeline machine (nextTransition, via decideStatus) runs from there
 * at the company's demo-clock today. So the same demo date shows the same statuses whether or not the clock was touched.
 *
 * Never moves an item out of to_report / reported / remitted / resolved_paid: a letter or a reply never un-files a
 * report or closes an item (owner replies are unverified bearer-token claims, security review H2).
 */
import { eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { outreach, outreachItems, staleItems, type StaleStatus } from "@/db/schema";
import * as clock from "@/lib/clock";
import type { IsoDate } from "@/lib/dates";
import type { MachineEvent } from "@/lib/timeline/machine";
import { decideStatus, type StatusInput } from "./compute";

/** Statuses a person's letter or an owner's reply may move: before reporting. */
const EVENT_MOVABLE: ReadonlySet<StaleStatus> = new Set<StaleStatus>(["watching", "needs_rule", "dd_pending", "dd_sent", "owner_responded"]);
/** Outreach states that mean the contact actually went out (offline sends included: a person approved and sent it). */
export const SENT_OUTREACH: ReadonlySet<string> = new Set(["sent", "delivered", "responded"]);

export interface PersonFacts {
  /** A due-diligence contact for the item went out. */
  letterSent: boolean;
  /** The owner replied. */
  ownerResponded: boolean;
}

export interface EventItem extends StatusInput {
  ddApplies: boolean | null;
}

/** Pure: the item's status after what a person did, at `today`. Returns the current status when it may not move. */
export function statusAfterPersonEvents(item: EventItem, facts: PersonFacts, today: IsoDate): StaleStatus {
  if (!EVENT_MOVABLE.has(item.status)) return item.status;
  if (!facts.letterSent && !facts.ownerResponded) return item.status;
  const events: MachineEvent[] = [{ type: "dd_sent" }];
  if (facts.ownerResponded) events.push({ type: "owner_responded", response: "other" });
  // The floor a person's action sets, exactly as the clock Reset restarts from it (src/lib/pipeline/clock-reset.ts).
  const floor: StaleStatus = facts.ownerResponded ? "owner_responded" : "dd_sent";
  const start: StaleStatus = item.status === "owner_responded" ? "owner_responded" : floor;
  return decideStatus({ ...item, status: start }, item.ddApplies, today, events).status;
}

const ddAppliesOf = (classification: unknown): boolean | null =>
  (classification as { timeline?: { ddApplies?: boolean | null } } | null)?.timeline?.ddApplies ?? null;

export interface StatusChange {
  staleItemId: string;
  from: StaleStatus;
  to: StaleStatus;
}

/**
 * Recompute the status of every item an outreach row covers (one-notice letters list several), from the person facts
 * on record, and persist the changes. Safe to call more than once: the machine is idempotent.
 */
export async function recomputeAfterOutreach(db: Db, outreachId: string): Promise<StatusChange[]> {
  const [row] = await db.select().from(outreach).where(eq(outreach.id, outreachId));
  if (!row) return [];
  const listed = await db.select({ id: outreachItems.staleItemId }).from(outreachItems).where(eq(outreachItems.outreachId, outreachId));
  const ids = [...new Set([row.staleItemId, ...listed.map((r) => r.id)])];
  return recomputeItems(db, row.companyId, ids);
}

/** Recompute the given items from every outreach row that covers them. */
export async function recomputeItems(db: Db, companyId: string, staleItemIds: readonly string[]): Promise<StatusChange[]> {
  if (staleItemIds.length === 0) return [];
  const today = await clock.now(db, companyId);
  const items = await db.select().from(staleItems).where(inArray(staleItems.id, [...staleItemIds]));
  const direct = await db.select().from(outreach).where(inArray(outreach.staleItemId, [...staleItemIds]));
  const viaItems = await db
    .select({ o: outreach, staleItemId: outreachItems.staleItemId })
    .from(outreachItems)
    .innerJoin(outreach, eq(outreach.id, outreachItems.outreachId))
    .where(inArray(outreachItems.staleItemId, [...staleItemIds]));
  const lettersOf = (id: string) => [...direct.filter((o) => o.staleItemId === id), ...viaItems.filter((r) => r.staleItemId === id).map((r) => r.o)];

  const changes: StatusChange[] = [];
  for (const item of items) {
    const letters = lettersOf(item.id);
    const facts: PersonFacts = {
      letterSent: letters.some((l) => SENT_OUTREACH.has(l.status)),
      ownerResponded: Boolean((item.classification as { ownerResponse?: unknown } | null)?.ownerResponse) || letters.some((l) => l.status === "responded" || l.respondedAt !== null),
    };
    const to = statusAfterPersonEvents({ ...item, ddApplies: ddAppliesOf(item.classification) }, facts, today);
    if (to === item.status) continue;
    await db.update(staleItems).set({ status: to }).where(eq(staleItems.id, item.id));
    changes.push({ staleItemId: item.id, from: item.status, to });
  }
  return changes;
}
