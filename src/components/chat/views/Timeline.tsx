"use client";

import { ChevronRight } from "lucide-react";
import { DateCell, SourceLink, UnknownBadge, UnverifiedBadge } from "@/components/primitives";
import type { Explanation, TimelineEvent } from "@/lib/queries/schemas";
import { cn } from "@/lib/utils";

export type NodeState = "past" | "next" | "future" | "unknown" | "na";

/** Past dates are solid blue, the next one gets a pink ring and a "Next" label, later ones are hollow (same as the Items drawer). */
export function nodeStates(events: TimelineEvent[], asOf: string): NodeState[] {
  let nextTaken = false;
  return events.map((e) => {
    if (e.status === "not_applicable") return "na";
    if (e.status === "unknown" || !e.date) return "unknown";
    if (e.date <= asOf) return "past";
    if (!nextTaken) {
      nextTaken = true;
      return "next";
    }
    return "future";
  });
}

const DOT: Record<NodeState, string> = {
  past: "bg-[var(--chat-blue-500)]",
  next: "bg-[var(--chat-ink-1)] ring-2 ring-[var(--chat-pink)]",
  future: "bg-[var(--chat-ink-1)] ring-1 ring-[var(--chat-t4)]",
  unknown: "bg-[var(--chat-ink-1)] ring-1 ring-[var(--chat-t3)]",
  na: "bg-transparent ring-1 ring-[var(--chat-line-strong)]",
};

function dedupeSources(sources: TimelineEvent["sources"]) {
  return [...new Map(sources.map((s) => [`${s.url}|${s.quote}`, s])).values()].slice(0, 3);
}

/** The legal timeline from the rule engine. Every date is computed by code; this only renders it. */
export function LegalTimeline({ explanation: e, className }: { explanation: Explanation; className?: string }) {
  const states = nodeStates(e.timeline, e.asOf);
  return (
    <ol className={cn("relative", className)} aria-label="Legal timeline">
      {e.timeline.map((t, idx) => {
        const state = states[idx]!;
        const last = idx === e.timeline.length - 1;
        const sources = dedupeSources(t.sources);
        const hasDetail = t.rulePaths.length > 0 || sources.length > 0;
        return (
          <li
            key={t.key}
            className="relative grid grid-cols-[1rem_minmax(0,1fr)] gap-x-3 pb-4 last:pb-1"
            aria-current={state === "next" ? "step" : undefined}
            data-node-state={state}
          >
            {!last ? (
              <span aria-hidden className={cn("absolute top-[18px] bottom-0 left-[7.5px] w-px", state === "past" ? "bg-[var(--chat-blue-500)]/45" : "bg-[var(--chat-line-strong)]")} />
            ) : null}
            <span className="relative mt-[3px] grid size-4 place-items-center">
              <span aria-hidden className={cn("size-2 rounded-full", DOT[state])} />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <span className={cn("text-[13px]", state === "past" || state === "next" ? "font-medium text-[var(--chat-t1)]" : "text-[var(--chat-t2)]")}>
                  {t.label}
                  {state === "next" ? <span className="ml-2 text-xs font-normal text-[var(--chat-pink-text)]">Next</span> : null}
                </span>
                {t.status === "ok" ? (
                  <span className="inline-flex items-center gap-2">
                    {!t.verified ? <UnverifiedBadge compact /> : null}
                    <DateCell date={t.date} className={cn("text-[13px] tabular-nums", state === "past" ? "text-[var(--chat-t3)]" : "text-[var(--chat-t1)]")} />
                  </span>
                ) : t.status === "unknown" ? (
                  <UnknownBadge label="Unknown" className="text-xs" />
                ) : (
                  <span className="text-xs text-[var(--chat-t3)]">Not applicable</span>
                )}
              </div>
              {t.notes.length ? <p className="mt-0.5 text-xs text-pretty text-[var(--chat-t3)]">{t.notes.join(" ")}</p> : null}
              {hasDetail ? (
                <details className="group/src mt-1 text-xs">
                  <summary className="chat-focus inline-flex min-h-6 cursor-pointer list-none items-center gap-1 rounded-[4px] text-[var(--chat-t3)] select-none hover:text-[var(--chat-t2)] [&::-webkit-details-marker]:hidden">
                    <ChevronRight className="size-3 transition-transform duration-150 group-open/src:rotate-90" strokeWidth={1.5} aria-hidden />
                    Rule and sources
                  </summary>
                  <div className="mt-1 space-y-1.5 pl-4">
                    {t.rulePaths.length ? (
                      <p className="font-mono text-[11px] break-all text-[var(--chat-t3)]">
                        {t.ruleVersion ? `rule ${t.ruleVersion}: ` : ""}
                        {t.rulePaths.join(", ")}
                      </p>
                    ) : null}
                    {sources.length ? (
                      <p className="flex flex-wrap gap-x-3 gap-y-1">
                        {sources.map((src) => (
                          <SourceLink key={`${src.url}${src.quote}`} url={src.url} title={src.title} quote={src.quote} />
                        ))}
                      </p>
                    ) : null}
                  </div>
                </details>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
