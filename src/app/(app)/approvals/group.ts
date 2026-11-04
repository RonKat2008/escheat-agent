import type { QueueEntry } from "./queue-data";

/** The order a notice goes out in (R3-13): a letter first, then an email, then a call. */
export const CHANNEL_SEQUENCE = ["letter", "email", "voice"] as const;
export type SequenceChannel = (typeof CHANNEL_SEQUENCE)[number];

/**
 * One queue row. Outreach drafts for the same owner item (letter, email, call) are one notice to one owner, so they
 * share a row with a channel sequence; reports, claims and rule changes are rows of their own.
 */
export interface QueueGroup {
  /** Stable row id: `g:<staleItemId>` for outreach, otherwise the entry key. */
  id: string;
  /** The member the row opens on: the first one still waiting on a person, in sequence order. */
  lead: QueueEntry;
  /** Members in sequence order (letter, email, call), pending ones before handled ones within a channel. */
  members: QueueEntry[];
  /** Any member still waits on a person. */
  actionable: boolean;
  /** How many members wait on a person (each still needs its own approval). */
  waiting: number;
}

const rank = (e: QueueEntry) => (e.outreach ? CHANNEL_SEQUENCE.indexOf(e.outreach.channel) : 0);

export function groupIdOf(e: QueueEntry): string {
  return e.outreach ? `g:${e.outreach.staleItemId}` : e.key;
}

/** Groups the (already sorted) queue. Row order follows each group's first appearance, so urgent rows stay on top. */
export function groupQueue(entries: readonly QueueEntry[]): QueueGroup[] {
  const order: string[] = [];
  const byId = new Map<string, QueueEntry[]>();
  for (const e of entries) {
    const id = groupIdOf(e);
    const list = byId.get(id);
    if (list) list.push(e);
    else {
      byId.set(id, [e]);
      order.push(id);
    }
  }
  return order.map((id) => {
    const members = [...byId.get(id)!].sort((a, b) => rank(a) - rank(b) || Number(b.actionable) - Number(a.actionable));
    const pending = members.filter((m) => m.actionable);
    return { id, lead: pending[0] ?? members[0]!, members, actionable: pending.length > 0, waiting: pending.length };
  });
}

/** The group holding an entry key (or matching a group id), if any. */
export function findGroup(groups: readonly QueueGroup[], key: string | null): QueueGroup | undefined {
  if (!key) return undefined;
  return groups.find((g) => g.id === key || g.members.some((m) => m.key === key));
}

/**
 * The member for each channel of an outreach group (the pending one when a channel has several rows). A cancelled
 * (discarded) draft is history, not a step: it never stands in for the channel, so the sequence still offers a new draft.
 * `open` is the entry on screen; a cancelled one stays a step while it is the one being viewed.
 */
export function sequenceOf(group: QueueGroup, open?: string): Partial<Record<SequenceChannel, QueueEntry>> {
  const out: Partial<Record<SequenceChannel, QueueEntry>> = {};
  for (const m of group.members) {
    const ch = m.outreach?.channel;
    if (!ch || out[ch]) continue;
    if (m.outreach?.status === "cancelled" && m.key !== open) continue;
    out[ch] = m;
  }
  return out;
}
