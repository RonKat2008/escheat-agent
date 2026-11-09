"use client";

import { BellRing } from "lucide-react";
import { Money } from "@/components/primitives";
import type { OverdueUi } from "@/lib/chat/ui-types";
import { AttentionPill, fmtDate, UnverifiedFlag } from "../parts";
import { ActionCardFrame, CoralLink, GhostLink } from "./frame";

function SectionHead({ title, count }: { title: string; count: number }) {
  return (
    <h4 className="flex items-baseline justify-between gap-3 px-4 pt-3 pb-1 sm:px-5">
      <span className="type-label">{title}</span>
      <span className="num text-xs text-fg-3">{count}</span>
    </h4>
  );
}

/**
 * "What's overdue / what needs me" (docs/ASK-MODE.md §2.1): the real items waiting on a person. Overdue dates are the
 * rules engine's persisted output (UNVERIFIED flagged; unknown dates are counted as UNKNOWN, never guessed). Each row's
 * coral link opens the page where the person acts. Nothing is approved from this card.
 */
export function OverdueView({ asOf, overdue, overdueCount, overdueCents, unknownCount, approvals, approvalsCount }: OverdueUi["props"]) {
  const nothing = overdueCount === 0 && approvalsCount === 0;
  return (
    <ActionCardFrame
      testId="view-overdue"
      icon={<BellRing />}
      eyebrow="What needs you"
      title={nothing ? "Nothing is waiting on you" : `${overdueCount} overdue · ${approvalsCount} waiting for approval`}
      meta={`As of ${fmtDate(asOf)}`}
      footer={
        <>
          <GhostLink href="/items?overdue=1">All overdue items</GhostLink>
          <GhostLink href="/approvals">Approvals</GhostLink>
        </>
      }
    >
      {nothing ? (
        <p className="px-4 py-4 text-[13px] text-fg-2 sm:px-5">No item is past a deadline and nothing is waiting for approval.</p>
      ) : null}
      {overdueCount > 0 ? (
        <section aria-label="Past a deadline" data-testid="overdue-section">
          <SectionHead title="Past a deadline" count={overdueCount} />
          <p className="px-4 pb-2 text-xs text-fg-3 sm:px-5">
            <span className="num text-fg-2">
              <Money cents={overdueCents} />
            </span>{" "}
            in total. Dates come from the rules engine.
          </p>
          <ul className="divide-y divide-line">
            {overdue.map((o) => (
              <li key={o.itemId} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 sm:px-5" data-testid="overdue-row">
                <div className="min-w-0 flex-1 basis-56">
                  <p className="truncate text-[13px] text-fg-1">
                    {o.payeeName}
                    {o.checkNumber ? <span className="num text-fg-3"> · #{o.checkNumber}</span> : null}
                    {o.state ? <span className="text-fg-3"> · {o.state}</span> : null}
                  </p>
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-3">
                    <span>
                      {o.obligation} {fmtDate(o.date)}
                    </span>
                    <AttentionPill>{o.daysLate} days late</AttentionPill>
                    {o.verified ? null : <UnverifiedFlag compact />}
                  </p>
                </div>
                <span className="num text-[13px] text-fg-1">
                  <Money cents={o.amountCents} />
                </span>
                <CoralLink href={o.href} testId="overdue-action">
                  Open item
                </CoralLink>
              </li>
            ))}
          </ul>
          {overdueCount > overdue.length ? <p className="px-4 py-2 text-xs text-fg-3 sm:px-5">+{overdueCount - overdue.length} more in Items.</p> : null}
        </section>
      ) : null}
      {unknownCount > 0 ? (
        <p className="border-t border-line px-4 py-2.5 text-xs text-fg-2 sm:px-5" data-testid="overdue-unknown">
          {unknownCount} open {unknownCount === 1 ? "item has a deadline" : "items have deadlines"} the rules engine could not compute (UNKNOWN). They are not counted as overdue.
        </p>
      ) : null}
      {approvalsCount > 0 ? (
        <section aria-label="Waiting for your approval" className="border-t border-line" data-testid="approvals-section">
          <SectionHead title="Waiting for your approval" count={approvalsCount} />
          <ul className="divide-y divide-line">
            {approvals.map((a) => (
              <li key={a.key} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 sm:px-5" data-testid="approval-row">
                <div className="min-w-0 flex-1 basis-56">
                  <p className="truncate text-[13px] text-fg-1">{a.title}</p>
                  <p className="truncate text-xs text-fg-3">{a.subtitle}</p>
                </div>
                <CoralLink href={a.href} testId="approval-action">
                  Review
                </CoralLink>
              </li>
            ))}
          </ul>
          {approvalsCount > approvals.length ? <p className="px-4 py-2 text-xs text-fg-3 sm:px-5">+{approvalsCount - approvals.length} more in Approvals.</p> : null}
        </section>
      ) : null}
    </ActionCardFrame>
  );
}
