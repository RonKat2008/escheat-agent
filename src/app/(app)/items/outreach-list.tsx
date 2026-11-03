"use client";

import { StatusLabel } from "@/components/primitives";
import { formatDate } from "@/lib/format";
import { useDraftState } from "./draft-state";
import "@/components/motion/motion.css";

export interface OutreachRow {
  id: string;
  channel: string;
  status: string;
  sentAt: string | null;
  createdAt: string;
}

/**
 * The item's outreach (F29): server rows, plus the draft this drawer just created until the refreshed server list
 * carries it. The extra row is the server's own answer (its outreach id), never a guess about what was stored.
 */
export function OutreachList({ rows }: { rows: OutreachRow[] }) {
  const { drafted } = useDraftState();
  const pending = drafted && !rows.some((r) => r.id === drafted.outreachId) ? drafted : null;
  if (rows.length === 0 && !pending) {
    return <p className="text-[13px] text-fg-2">No outreach yet. Drafting a letter queues it for your approval; nothing is sent automatically.</p>;
  }
  return (
    <ul className="border-t border-line" data-testid="outreach-list">
      {pending ? (
        <li className="es-pop-inflex items-center gap-3 border-b border-line py-2 text-[13px]" data-testid="outreach-just-drafted" data-outreach-id={pending.outreachId}>
          <span className="w-14 text-fg-1 capitalize">{pending.channel}</span>
          <span className="text-fg-1">Letter draft waiting for approval</span>
          <span className="ml-auto text-xs text-fg-3">just now</span>
        </li>
      ) : null}
      {rows.map((o) => (
        <li key={o.id} className="flex items-center gap-3 border-b border-line py-2 text-[13px]" data-outreach-id={o.id}>
          <span className="w-14 text-fg-1 capitalize">{o.channel}</span>
          <StatusLabel status={o.status} size="sm" />
          <span className="num ml-auto truncate text-xs text-fg-3">{formatDate((o.sentAt ?? o.createdAt).slice(0, 10))}</span>
        </li>
      ))}
    </ul>
  );
}
