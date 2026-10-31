"use client";

import { FileText, Scale } from "lucide-react";
import { DateCell, Money, UnverifiedBanner } from "@/components/primitives";
import type { ItemTimelineUi } from "@/lib/chat/ui-types";
import { AskButton, AttentionNote, fmtDate, FooterLink, StatusTag, UnknownFlag, ViewCard } from "./parts";
import { LegalTimeline } from "./Timeline";

export function ItemTimelineView({ explanation: e }: ItemTimelineUi["props"]) {
  const item = e.item;
  const check = item.checkNumber;
  const anyUnverified = e.timeline.some((t) => t.status === "ok" && !t.verified);
  return (
    <ViewCard
      testId="view-item-timeline"
      icon={<Scale />}
      title={
        <>
          {item.payeeName}
          {check ? <span className="ml-2 font-mono text-xs font-normal text-[var(--chat-t3)]">#{check}</span> : null}
        </>
      }
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
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-b border-[var(--chat-line)] px-4 py-4 text-[13px] @lg:grid-cols-4">
        <div>
          <dt className="text-xs text-[var(--chat-t3)]">Amount</dt>
          <dd className="mt-0.5 text-base font-semibold text-[var(--chat-t1)]"><Money cents={item.amount.cents} /></dd>
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
            <DateCell date={item.issueDate} /> <span className="text-xs text-[var(--chat-t3)]">({item.ageDays}d)</span>
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
          <UnverifiedBanner className="mb-4 text-xs">Unverified: these dates rest on rule values no person has checked against the official source yet.</UnverifiedBanner>
        ) : null}
        <LegalTimeline explanation={e} />
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
