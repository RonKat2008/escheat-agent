"use client";

import { StatusLabel } from "@/components/primitives";
import { formatDate } from "@/lib/format";
import type { DiscardRecord } from "@/lib/queries/discards";
import { useDraftState } from "./draft-state";
import "@/components/motion/motion.css";

/** Plain, honest one-liner for a discarded draft. */
export function discardLine(d: DiscardRecord): string {
  const when = d.at ? ` on ${formatDate(d.at.slice(0, 10))}` : "";
  return `Discarded by ${d.by ?? "a reviewer"}${when}. Reason: ${d.reason || "none given"}. Nothing was sent.`;
}

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
export function OutreachList({ rows, discards = [] }: { rows: OutreachRow[]; discards?: DiscardRecord[] }) {
  const discardOf = new Map(discards.map((d) => [d.outreachId, d]));
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
        <li key={o.id} className="border-b border-line py-2 text-[13px]" data-outreach-id={o.id}>
          <div className="flex items-center gap-3">
            <span className="w-14 text-fg-1 capitalize">{o.channel}</span>
            <StatusLabel status={o.status} size="sm" />
            <span className="num ml-auto truncate text-xs text-fg-3">{formatDate((o.sentAt ?? o.createdAt).slice(0, 10))}</span>
          </div>
          {discardOf.get(o.id) ? (
            <p className="mt-1 pl-[68px] text-xs text-fg-2" data-testid="outreach-discarded">
              {discardLine(discardOf.get(o.id)!)}
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
