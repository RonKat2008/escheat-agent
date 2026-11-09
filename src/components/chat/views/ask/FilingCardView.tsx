"use client";

import { useState } from "react";
import { FileCheck2 } from "lucide-react";
import { Money } from "@/components/primitives";
import { approvalRequest } from "@/lib/ask/cards/approval-request";
import type { FilingCardUi } from "@/lib/ask/cards/approval-ui-types";
import { CARD_PROMPT } from "@/lib/ask/cards/registry";
import { AskButton, fmtDate, StatusTag, UnverifiedFlag } from "../parts";
import { ApproveControl } from "./ApproveControl";
import { acknowledgeText } from "./ReviewApprovalsView";
import { ActionCardFrame, CoralLink, GhostLink } from "./frame";

const FILED = new Set(["submitted", "confirmed"]);

/**
 * "File the <STATE> report" (docs/ASK-MODE.md slice 4): report readiness, then the approval step when the report is
 * not approved (the same endpoint and checksum as Reports), then the existing replica filing flow. The card never
 * starts a filing itself: the close-out runner does, on the replica portal, and the filing agent checks the approval
 * (assertApproved) before it opens the portal.
 */
export function FilingCardView(p: FilingCardUi["props"]) {
  const r = p.report;
  const [approved, setApproved] = useState(false);
  const status = approved ? "approved" : (r?.status ?? null);
  const filed = status !== null && FILED.has(status);
  const isApproved = status === "approved";
  return (
    <ActionCardFrame
      testId="view-filing"
      icon={<FileCheck2 />}
      eyebrow={`File the ${p.state} report`}
      title={!r ? `No ${p.state} report for this cycle yet` : filed ? `${p.state} report is on the replica portal` : isApproved ? `${p.state} report approved, ready to file` : `${p.state} report needs approval`}
      meta={`As of ${fmtDate(p.asOf)}`}
      footer={
        <>
          <GhostLink href={p.reportsHref}>Reports</GhostLink>
          <AskButton question={CARD_PROMPT.review_approvals}>Review approvals</AskButton>
        </>
      }
    >
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 px-4 py-4 text-[13px] sm:grid-cols-4 sm:px-5" data-testid="filing-facts" data-status={status ?? "none"}>
        <div>
          <dt className="text-xs text-fg-3">To report</dt>
          <dd className="num text-fg-1">
            {p.toReport.count} · <Money cents={p.toReport.cents} />
          </dd>
        </div>
        <div>
          <dt className="text-xs text-fg-3">Rule file</dt>
          <dd className="text-fg-1">
            {p.hasRules ? (p.ruleVersion ?? "loaded") : "not loaded"}
            {p.unverifiedRules > 0 ? <UnverifiedFlag compact className="ml-1.5" /> : null}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-fg-3">Report</dt>
          <dd className="text-fg-1">{r ? <StatusTag status={status ?? r.status} /> : "Not generated"}</dd>
        </div>
        <div>
          <dt className="text-xs text-fg-3">Validation</dt>
          <dd className="num text-fg-1">{r ? `${r.errorCount} errors · ${r.warningCount} warnings` : "—"}</dd>
        </div>
      </dl>
      {p.unverifiedRules > 0 ? (
        <p className="px-4 pb-3 text-[13px] text-fg-2 sm:px-5">
          This cycle relies on {p.unverifiedRules} UNVERIFIED rule {p.unverifiedRules === 1 ? "value" : "values"}. They come from the rule file; nobody has checked them against the statute yet.
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3 sm:px-5" data-testid="filing-next">
        {!r ? (
          <>
            <p className="min-w-0 flex-1 basis-56 text-[13px] text-fg-2">Generate the {p.state} file in Reports first. It is validated before anyone can approve it.</p>
            <CoralLink href={p.reportsHref}>Generate in Reports</CoralLink>
          </>
        ) : filed ? (
          <p className="text-[13px] text-fg-2">
            Filed on the replica {p.state} portal{r.confirmation ? ` (confirmation ${r.confirmation})` : ""}. Nothing was filed with a real state.
          </p>
        ) : isApproved ? (
          <>
            <p className="min-w-0 flex-1 basis-56 text-[13px] text-fg-2">
              Approved. Filing runs only on the replica {p.state} portal, from the close-out runner; the filing agent re-checks this approval first.
              {p.filingRun ? ` Last filing run: ${p.filingRun.status}.` : ""}
            </p>
            <CoralLink href={p.runnerHref} testId="filing-open-runner">
              Open the replica filing runner
            </CoralLink>
          </>
        ) : r.approve ? (
          <>
            <p className="w-full text-[13px] text-fg-2">
              {r.itemCount} items, <Money cents={r.totalCents} />. Approving is bound to this file&apos;s checksum and files nothing.
            </p>
            <ApproveControl
              label="Approve for filing"
              acknowledge={acknowledgeText(r.approve)}
              request={(name, ack) => approvalRequest(r.approve!, name, ack)}
              testId="filing-approve"
              statusOf={r.approve}
              onDone={() => setApproved(true)}
            />
          </>
        ) : (
          <>
            <p className="min-w-0 flex-1 basis-56 text-[13px] text-fg-2">
              {r.errorCount > 0 ? `The file has ${r.errorCount} validation errors. Fix them in Reports and regenerate before approving.` : "Review this report in Reports."}
            </p>
            <CoralLink href={p.reportsHref}>Open in Reports</CoralLink>
          </>
        )}
      </div>
    </ActionCardFrame>
  );
}
