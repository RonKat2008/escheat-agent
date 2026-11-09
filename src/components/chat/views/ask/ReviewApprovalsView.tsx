"use client";

import { BadgeDollarSign, FileCheck2, Inbox, Mail, Phone, ScrollText, Send } from "lucide-react";
import { Money } from "@/components/primitives";
import { approvalRequest, needsAcknowledgement } from "@/lib/ask/cards/approval-request";
import type { ApprovalsReviewUi, CardApproval, ReviewKind, ReviewRow } from "@/lib/ask/cards/approval-ui-types";
import { fmtDate, UnverifiedFlag } from "../parts";
import { ApproveControl } from "./ApproveControl";
import { ActionCardFrame, GhostLink } from "./frame";

const ICON: Record<ReviewKind, typeof Mail> = { letter: Send, email: Mail, voice: Phone, report: FileCheck2, claim: BadgeDollarSign, rule: ScrollText };
const APPROVE_LABEL: Record<ReviewKind, string> = {
  letter: "Approve letter",
  email: "Approve email",
  voice: "Approve call",
  report: "Approve for filing",
  claim: "Approve claim",
  rule: "Approve",
};

/** The "approve anyway" wording of the Approvals page (components/b/ApproveAnywayBox.tsx), from server-derived counts. */
export function acknowledgeText(a: CardApproval) {
  if (a.kind !== "report" || !needsAcknowledgement(a)) return undefined;
  const parts = [
    a.unverified > 0 ? `this file relies on ${a.unverified} UNVERIFIED rule ${a.unverified === 1 ? "value" : "values"} nobody has checked against the statute yet` : null,
    a.unsent > 0 ? `${a.unsent} required due-diligence ${a.unsent === 1 ? "notice was" : "notices were"} never sent` : null,
  ].filter(Boolean);
  return `Approve anyway: ${parts.join(", and ")}. The count you acknowledge is frozen on the filing record.`;
}

function Fact({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-fg-3">{term}</dt>
      <dd className="min-w-0 text-fg-1">{children}</dd>
    </>
  );
}

function Row({ row }: { row: ReviewRow }) {
  const Icon = ICON[row.kind];
  const approve = row.approve;
  return (
    <li className="space-y-3 px-4 py-3.5 sm:px-5" data-testid="review-row" data-kind={row.kind}>
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <Icon className="mt-0.5 size-4 shrink-0 text-fg-3" strokeWidth={1.5} aria-hidden />
        <div className="min-w-0 flex-1 basis-56">
          <p className="text-[13px] text-pretty text-fg-1">{row.title}</p>
          <p className="text-xs text-fg-3">{row.subtitle}</p>
        </div>
        {row.amountCents !== null ? (
          <span className="num text-[13px] text-fg-1">
            <Money cents={row.amountCents} />
          </span>
        ) : null}
      </div>
      <dl className="grid gap-x-4 gap-y-1 text-[13px] sm:grid-cols-[7.5rem_minmax(0,1fr)]">
        <Fact term="Goes to">
          {row.recipient.map((line, i) => (
            <span key={`${i}-${line}`} className={i > 0 ? "block text-fg-2" : "block"}>
              {line}
            </span>
          ))}
        </Fact>
        <Fact term="Covers">
          {row.payload.map((line) => (
            <span key={line} className="block text-fg-2">
              {line}
            </span>
          ))}
          {row.unverified ? <UnverifiedFlag compact className="mt-1" /> : null}
        </Fact>
        <Fact term="Approve does">{row.approveEffect}</Fact>
        <Fact term="Then">{row.irreversible}</Fact>
      </dl>
      {row.bodyText ? (
        <details className="group rounded-lg border border-line">
          <summary className="cursor-pointer rounded-lg px-3 py-2 text-[13px] text-fg-2 outline-none hover:text-fg-1 focus-visible:outline-2 focus-visible:outline-blue-400">
            Read the letter exactly as it will print
          </summary>
          <pre
            tabIndex={0}
            aria-label="Letter text"
            className="max-h-64 overflow-y-auto border-t border-line px-3 py-2.5 font-sans text-[13px] leading-relaxed whitespace-pre-wrap text-fg-2 outline-none focus-visible:outline-2 focus-visible:outline-blue-400"
          >
            {row.bodyText}
          </pre>
        </details>
      ) : null}
      {row.blockers.map((b) => (
        <p key={b} className="text-[13px] text-fg-2">
          {b}
        </p>
      ))}
      <div className="flex flex-wrap items-end gap-2">
        {approve ? (
          <div className="min-w-0 flex-1 basis-64">
            <ApproveControl
              label={APPROVE_LABEL[row.kind]}
              acknowledge={acknowledgeText(approve)}
              request={(name, ack) => approvalRequest(approve, name, ack)}
              testId="review-approve"
            />
          </div>
        ) : null}
        <GhostLink href={row.openHref}>{approve ? "Decline or edit in Approvals" : "Open in Approvals"}</GhostLink>
      </div>
    </li>
  );
}

/**
 * "Review approvals" (docs/ASK-MODE.md slice 4): every pending approval grouped by action. Each row shows what the
 * approval binds to and what can follow it. Approve posts to the existing approval route with the server-issued hash;
 * declining, editing and anything that needs a recipient or a rule review happens in Approvals or Rules.
 */
export function ReviewApprovalsView({ asOf, total, groups }: ApprovalsReviewUi["props"]) {
  return (
    <ActionCardFrame
      testId="view-approvals-review"
      icon={<Inbox />}
      eyebrow="Review approvals"
      title={total === 0 ? "Nothing is waiting for approval" : `${total} ${total === 1 ? "approval waits" : "approvals wait"} for a person`}
      meta={`As of ${fmtDate(asOf)}`}
      footer={<GhostLink href="/approvals">All approvals</GhostLink>}
    >
      {total === 0 ? <p className="px-4 py-4 text-[13px] text-fg-2 sm:px-5">Drafts, reports and claims that need a person show up here.</p> : null}
      {groups.map((g) => (
        <section key={g.kind} aria-label={g.label} className="border-t border-line first:border-t-0" data-testid="review-group" data-kind={g.kind}>
          <h4 className="flex items-baseline justify-between gap-3 px-4 pt-3 sm:px-5">
            <span className="type-label">{g.label}</span>
            <span className="num text-xs text-fg-3">{g.rows.length + g.more}</span>
          </h4>
          <ul className="divide-y divide-line">
            {g.rows.map((r) => (
              <Row key={r.key} row={r} />
            ))}
          </ul>
          {g.more > 0 ? <p className="px-4 pb-3 text-xs text-fg-3 sm:px-5">+{g.more} more in Approvals.</p> : null}
        </section>
      ))}
    </ActionCardFrame>
  );
}
