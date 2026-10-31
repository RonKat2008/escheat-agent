"use client";

import { useState } from "react";
import { CalendarClock } from "lucide-react";
import type { DeadlinesUi } from "@/lib/chat/ui-types";
import type { DeadlineEvent } from "@/lib/queries/schemas";
import { AttentionPill, DEADLINE_LABEL, fmtDate, FooterLink, UnverifiedFlag, useChatActions, ViewCard } from "./parts";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const COLLAPSED = 10;

function groupByMonth(events: DeadlineEvent[]): [string, DeadlineEvent[]][] {
  const map = new Map<string, DeadlineEvent[]>();
  for (const e of events) {
    const key = e.date.slice(0, 7);
    map.set(key, [...(map.get(key) ?? []), e]);
  }
  return [...map.entries()];
}

const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

export function DeadlinesView({ asOf, days, events }: DeadlinesUi["props"]) {
  const { ask, canAsk } = useChatActions();
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? events : events.slice(0, COLLAPSED);
  const unverified = events.filter((e) => !e.verified).length;

  return (
    <ViewCard
      testId="view-deadlines"
      icon={<CalendarClock />}
      title={`Deadlines in the next ${days} days`}
      meta={`${events.length} from ${fmtDate(asOf)}`}
      footer={
        <>
          {events.length > COLLAPSED ? (
            <button type="button" onClick={() => setExpanded((v) => !v)} className="h-8 rounded-md px-2 text-[13px] text-[var(--chat-t2)] outline-none hover:bg-[var(--chat-ink-3)] hover:text-[var(--chat-t1)] focus-visible:ring-2 focus-visible:ring-[var(--chat-blue-text)]">
              {expanded ? "Show fewer" : `Show all ${events.length}`}
            </button>
          ) : null}
          {unverified ? <span className="flex items-center gap-1.5 text-xs text-[var(--chat-t3)]"><UnverifiedFlag compact />{unverified} rest on unverified rules</span> : null}
          <span className="flex-1" />
          <FooterLink href="/dashboard">Dashboard</FooterLink>
        </>
      }
    >
      {events.length === 0 ? (
        <p className="px-4 py-6 text-sm text-[var(--chat-t3)]">Nothing is due in this window.</p>
      ) : (
        <div className="divide-y divide-[var(--chat-line)]">
          {groupByMonth(shown).map(([ym, list]) => (
            <section key={ym} aria-label={monthLabel(ym)}>
              <h4 className="sticky top-0 bg-[var(--chat-ink-1)] px-4 pt-3 pb-1 text-xs font-medium text-[var(--chat-t3)]">{monthLabel(ym)}</h4>
              <ul>
                {list.map((e) => (
                  <li key={`${e.itemId}-${e.kind}`}>
                    <button
                      type="button"
                      disabled={!canAsk || !e.checkNumber}
                      onClick={() => e.checkNumber && ask(`Explain check #${e.checkNumber}`)}
                      className="group grid w-full grid-cols-[3.25rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2 text-left outline-none transition-colors duration-150 hover:bg-[var(--chat-ink-3)] focus-visible:bg-[var(--chat-ink-3)] disabled:cursor-default"
                    >
                      <span className="flex flex-col leading-tight">
                        <span className="text-[13px] text-[var(--chat-t1)] tabular-nums">{fmtDate(e.date, { year: false })}</span>
                        {e.daysUntil <= 14 ? (
                          <AttentionPill className="mt-0.5 h-[18px] w-fit px-1.5 text-[11px] tabular-nums">{e.daysUntil === 0 ? "today" : `${e.daysUntil}d`}</AttentionPill>
                        ) : (
                          <span className="text-[11px] text-[var(--chat-t3)] tabular-nums">in {e.daysUntil}d</span>
                        )}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] text-[var(--chat-t1)] group-hover:text-[var(--chat-blue-text)]">{DEADLINE_LABEL[e.kind] ?? e.kind}</span>
                        <span className="block truncate text-xs text-[var(--chat-t3)]">
                          {e.payeeName}
                          {e.checkNumber ? `, #${e.checkNumber}` : ""}
                          {e.state ? `, ${e.state}` : ""}
                        </span>
                      </span>
                      <span className="flex items-center gap-2">
                        {e.verified ? null : <UnverifiedFlag compact />}
                        <span className="text-[13px] text-[var(--chat-t2)] tabular-nums">{e.amount.formatted}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </ViewCard>
  );
}
