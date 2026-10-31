"use client";

import { ChevronRight, FileText, Scale, ShieldQuestion } from "lucide-react";
import type { ItemTimelineUi } from "@/lib/chat/ui-types";
import type { TimelineEvent } from "@/lib/queries/schemas";
import { cn } from "@/lib/utils";
import { AskButton, AttentionNote, fmtDate, FooterLink, StatusTag, UnknownFlag, VerifiedFlag, ViewCard } from "./parts";

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function Marker({ e, past }: { e: TimelineEvent; past: boolean }) {
  const attention = e.status === "unknown" || (e.status === "ok" && !e.verified);
  return (
    <span
      aria-hidden
      className={cn(
        "absolute top-1.5 left-0 size-[11px] rounded-full border-2",
        e.status === "not_applicable"
          ? "border-[var(--chat-line-strong)] bg-transparent"
          : attention
            ? "border-[var(--chat-t3)] bg-black"
            : past
              ? "border-[var(--chat-blue-500)] bg-[var(--chat-blue-500)]"
              : "border-[var(--chat-blue-500)] bg-black",
      )}
    />
  );
}

export function ItemTimelineView({ explanation: e }: ItemTimelineUi["props"]) {
  const item = e.item;
  const check = item.checkNumber;
  const anyUnverified = e.timeline.some((t) => t.status === "ok" && !t.verified);
  return (
    <ViewCard
      testId="view-item-timeline"
      icon={<Scale />}
      title={`${item.payeeName}${check ? `, check #${check}` : ""}`}
      meta={`as of ${fmtDate(e.asOf)}`}
      footer={
        <>
          {check && !["resolved_paid", "remitted"].includes(item.status) ? (
            <AskButton question={`Draft the due-diligence letter for #${check}`}>
              <FileText className="size-3.5" aria-hidden />
              Draft the letter
            </AskButton>
          ) : null}
          <span className="flex-1" />
          <FooterLink href={`/items?item=${encodeURIComponent(check ?? item.id)}`}>Open in Items</FooterLink>
        </>
      }
    >
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-b border-[var(--chat-line)] px-4 py-4 text-[13px] sm:grid-cols-4">
        <div>
          <dt className="text-xs text-[var(--chat-t3)]">Amount</dt>
          <dd className="mt-0.5 text-base font-semibold text-[var(--chat-t1)] tabular-nums">{item.amount.formatted}</dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--chat-t3)]">Owner state</dt>
          <dd className="mt-0.5 text-[var(--chat-t1)]">
            {item.ownerState ?? <UnknownFlag />}
            {item.ownerStateBasis ? <span className="ml-1.5 text-xs text-[var(--chat-t3)]">by {item.ownerStateBasis}</span> : null}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--chat-t3)]">Issued</dt>
          <dd className="mt-0.5 text-[var(--chat-t1)] tabular-nums">
            {fmtDate(item.issueDate)} <span className="text-xs text-[var(--chat-t3)]">({item.ageDays}d)</span>
          </dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--chat-t3)]">Status</dt>
          <dd className="mt-1">
            <StatusTag status={item.status} />
          </dd>
        </div>
      </dl>

      <div className="px-4 pt-4 pb-2">
        <p className="mb-3 text-xs text-[var(--chat-t3)]">
          Legal timeline from the rule engine{e.rules.pinnedVersion ? `, ${e.rules.state} rules v${e.rules.pinnedVersion}` : ""}. Dates are computed, not written by the assistant.
        </p>
        {anyUnverified ? (
          <p data-testid="chat-unverified" className="mb-4 flex items-start gap-2 rounded-[6px] bg-[var(--chat-blue-900)] px-3 py-2 text-xs text-[var(--chat-blue-300)]">
            <ShieldQuestion className="mt-px size-3.5 shrink-0" strokeWidth={1.5} aria-hidden />
            <span className="text-pretty">Unverified: these dates rest on rule values no person has checked against the official source yet.</span>
          </p>
        ) : null}
        <ol className="relative">
          {e.timeline.map((t, idx) => {
            const past = t.date !== null && t.date <= e.asOf;
            const last = idx === e.timeline.length - 1;
            const sources = [...new Map(t.sources.map((src) => [src.url, src])).values()].slice(0, 3);
            const hasDetail = t.rulePaths.length > 0 || sources.length > 0;
            return (
              <li key={t.key} className="relative pb-4 pl-6 last:pb-2">
                {!last ? <span aria-hidden className="absolute top-4 bottom-0 left-[5px] w-px bg-[var(--chat-line-strong)]" /> : null}
                <Marker e={t} past={past} />
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                  <span className="text-[13px] text-[var(--chat-t1)]">{t.label}</span>
                  {t.status === "ok" ? (
                    <span className={cn("inline-flex items-center gap-1.5 text-[13px] tabular-nums", past ? "text-[var(--chat-t3)]" : "text-[var(--chat-t1)]")}>
                      {t.verified ? <VerifiedFlag className="[&>svg]:size-3" /> : null}
                      {fmtDate(t.date)}
                    </span>
                  ) : t.status === "unknown" ? (
                    <UnknownFlag />
                  ) : (
                    <span className="text-xs text-[var(--chat-t3)]">Not applicable</span>
                  )}
                </div>
                {t.notes.length ? <p className="mt-0.5 text-xs text-pretty text-[var(--chat-t3)]">{t.notes.join(" ")}</p> : null}
                {hasDetail ? (
                  <details className="group mt-1 text-xs">
                    <summary className="chat-focus inline-flex cursor-pointer list-none items-center gap-1 rounded-[4px] text-[var(--chat-t3)] select-none hover:text-[var(--chat-t2)] [&::-webkit-details-marker]:hidden">
                      <ChevronRight className="size-3 transition-transform duration-150 group-open:rotate-90" strokeWidth={1.5} aria-hidden />
                      Rule and sources
                    </summary>
                    <div className="mt-1.5 space-y-1.5 pl-4">
                      {t.rulePaths.length ? (
                        <p className="font-mono text-[11px] break-all text-[var(--chat-t3)]">
                          {t.ruleVersion ? `v${t.ruleVersion}: ` : ""}
                          {t.rulePaths.join(", ")}
                        </p>
                      ) : null}
                      {sources.length ? (
                        <p className="flex flex-wrap gap-x-3 gap-y-1">
                          {sources.map((src) => (
                            <a key={src.url} href={src.url} target="_blank" rel="noopener noreferrer" className="chat-link" title={src.quote || src.title}>
                              {src.title || hostOf(src.url)}
                            </a>
                          ))}
                        </p>
                      ) : null}
                    </div>
                  </details>
                ) : null}
              </li>
            );
          })}
        </ol>
      </div>
      {e.warnings.length ? (
        <div className="space-y-1.5 border-t border-[var(--chat-line)] px-4 py-3">
          {e.warnings.map((w) => (
            <AttentionNote key={w}>{w}</AttentionNote>
          ))}
        </div>
      ) : null}
      {e.outreach.length ? (
        <p className="border-t border-[var(--chat-line)] px-4 py-2.5 text-xs text-[var(--chat-t3)]">
          Outreach: {e.outreach.map((o) => `${o.channel} ${o.status.replaceAll("_", " ")}`).join(", ")}
        </p>
      ) : null}
    </ViewCard>
  );
}
