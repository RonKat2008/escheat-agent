"use client";

import { Percent } from "lucide-react";
import { Money } from "@/components/primitives";
import type { InterestUi } from "@/lib/chat/ui-types";
import { fmtDate, UnknownFlag, UnverifiedFlag, ViewCard } from "./parts";

export function InterestView({ interest: r }: InterestUi["props"]) {
  return (
    <ViewCard testId="view-interest" icon={<Percent />} title="Audit-interest exposure (estimate)" meta={`as of ${fmtDate(r.asOf)}`}>
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2 border-b border-[var(--chat-line)] px-4 py-4">
        <p className="text-[1.75rem] leading-none font-semibold tracking-[-0.02em] text-[var(--chat-t1)] tabular-nums">{r.total ? <Money cents={r.total.cents} /> : "Unknown"}</p>
        <p className="pb-0.5 text-[13px] text-[var(--chat-t3)]">{r.label}</p>
        <span className="flex gap-1.5 pb-0.5">
          {r.anyUnverified ? <UnverifiedFlag /> : null}
          {r.anyUnknown ? <UnknownFlag /> : null}
        </span>
      </div>
      <ul className="divide-y divide-[var(--chat-line)]">
        {r.byState.map((s) => (
          <li key={s.state} className="grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-start gap-3 px-4 py-3 text-[13px]">
            <span className="font-semibold text-[var(--chat-t1)]">{s.state}</span>
            <span className="min-w-0 text-[var(--chat-t3)]">
              {s.itemCount} items, principal <span className="text-[var(--chat-t2)] tabular-nums"><Money cents={s.principal.cents} /></span>
              {s.notes.length ? <span className="mt-1 block text-xs text-pretty text-[var(--chat-t3)]">{s.notes.join(" ")}</span> : null}
            </span>
            <span className="flex items-center gap-2 text-right">
              {s.status === "unknown" ? <UnknownFlag /> : !s.verified ? <UnverifiedFlag compact /> : null}
              <span className="text-[var(--chat-t1)] tabular-nums">{s.interest ? <Money cents={s.interest.cents} /> : "—"}</span>
            </span>
          </li>
        ))}
      </ul>
    </ViewCard>
  );
}
