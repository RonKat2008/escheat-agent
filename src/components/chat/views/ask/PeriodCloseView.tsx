"use client";

import { useState } from "react";
import { Download, Lock } from "lucide-react";
import { Money } from "@/components/primitives";
import { closeRequest } from "@/lib/ask/cards/approval-request";
import type { PeriodCloseUi, TieStateLine } from "@/lib/ask/cards/approval-ui-types";
import { closeMonthPrompt } from "@/lib/ask/cards/registry";
import { monthLabel } from "@/lib/close-pack/period";
import { priorPeriodLine } from "@/lib/ledger/adjustment-copy";
import { AskButton, fmtDate, UnverifiedFlag, usd } from "../parts";
import { ApproveControl } from "./ApproveControl";
import { ActionCardFrame, GhostLink } from "./frame";

const short = (hash: string) => `${hash.slice(0, 4)}…`;

function TieRow({ line, total }: { line: TieStateLine; total?: boolean }) {
  return (
    <tr className={total ? "border-t border-line-strong font-medium" : "border-t border-line"} data-testid="tie-row">
      <th scope="row" className="py-1.5 pr-3 text-left font-normal text-fg-1">
        {line.state}
        {!total && !line.hasRules ? <span className="ml-1.5 text-xs text-fg-3">no rule file</span> : null}
        {!total && line.unverifiedRules > 0 ? <UnverifiedFlag compact className="ml-1.5" /> : null}
      </th>
      <td className="num py-1.5 pr-3 text-right text-fg-2">
        <Money cents={line.openingCents} />
      </td>
      <td className="num py-1.5 pr-3 text-right text-fg-1">
        <Money cents={line.closingCents} />
      </td>
      <td className="py-1.5 text-right text-xs">{line.reconciles ? <span className="text-blue-300">Ties</span> : <span className="text-pink-300">Does not tie</span>}</td>
    </tr>
  );
}

/**
 * "Close <Month YYYY>" (docs/ASK-MODE.md slice 4): the month's journal, its roll-forward tie-out by state, and the
 * irreversible close behind a typed name. Approve close POSTs /api/close-pack exactly as the Ledger's close button does:
 * the server binds the close_period approval to the journal hash shown here, consumes it once, and refuses a changed
 * journal. A closed month offers its frozen pack instead, and its tie-out shows the figures FROZEN at close, labelled
 * "Closed <date> by <name>", never live totals (R11-01). Late activity dated in it is shown as what it is: posted to
 * the open month as a prior-period adjustment. Months close in order (R11-04): any other month explains which to
 * close first and offers no close.
 */
export function PeriodCloseView({ asOf, period, label, status, preview, tieOut, closed, otherOpen, blocked, adjustment, lateActivity }: PeriodCloseUi["props"]) {
  const [closedNow, setClosedNow] = useState<{ chainSeq: number; manifestSha256: string } | null>(null);
  const isClosed = status === "closed" || closedNow !== null;
  const done = closed ?? (closedNow ? { ...closedNow, closedBy: "", demoDate: asOf, frozen: true } : null);
  const frozenCaption = isClosed && closed?.frozen ? `Frozen at close on ${fmtDate(closed.demoDate)}: ` : "";
  return (
    <ActionCardFrame
      testId="view-period-close"
      icon={<Lock />}
      eyebrow="Month-end close"
      title={isClosed ? `${label} is closed` : status === "open" ? `Close ${label}` : `${label} has not started`}
      meta={`As of ${fmtDate(asOf)}`}
      footer={
        <>
          {otherOpen.map((m) => (
            <AskButton key={m.period} question={closeMonthPrompt(m.label)}>
              Close {m.label}
            </AskButton>
          ))}
          <span className="flex-1" />
          <GhostLink href="/ledger">Ledger</GhostLink>
        </>
      }
    >
      <div className="space-y-3 px-4 py-4 sm:px-5" data-testid="period-close-body" data-period={period} data-status={isClosed ? "closed" : status}>
        {status === "not_started" ? <p className="text-[13px] text-fg-2">{label} has not started on the demo clock, so there is nothing to close.</p> : null}
        {blocked && !isClosed ? (
          <p className="text-[13px] text-fg-1" data-testid="period-close-blocked">
            {blocked}
          </p>
        ) : null}
        {preview && !isClosed && !blocked ? (
          <p className="text-[13px] text-fg-2">
            Closing freezes {preview.entryCount} journal {preview.entryCount === 1 ? "entry" : "entries"} (closing liability{" "}
            <span className="num text-fg-1">
              <Money cents={preview.closingCents} />
            </span>
            ) and writes the close pack&apos;s manifest hash into the audit chain. <span className="text-fg-1">It cannot be undone.</span> Nothing is posted to an
            accounting system.
          </p>
        ) : null}
        {preview?.notOver && !isClosed ? (
          <p className="text-[13px] text-pink-300" data-testid="period-close-not-over">
            {label} is not over on the demo clock: this close covers through {fmtDate(preview.coversThrough)}. Anything dated later posts to the next month.
          </p>
        ) : null}
        {tieOut ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[17rem] text-[13px]" data-testid="period-close-tieout">
              <caption className="pb-1 text-left text-xs text-fg-3">
                {frozenCaption ? "Frozen at close" : "Roll-forward tie-out"}
                {frozenCaption ? ` (${fmtDate(closed!.demoDate)})` : ""}: {tieOut.allTie ? (frozenCaption ? "every state tied" : "every state ties") : frozenCaption ? "some states did not tie" : "some states do not tie"}.
                {tieOut.states.some((s) => s.unverifiedRules > 0) ? " Flagged states rest on UNVERIFIED rule values from their rule files." : ""}
              </caption>
              <thead>
                <tr className="text-xs text-fg-3">
                  <th scope="col" className="pb-1 text-left font-normal">
                    State
                  </th>
                  <th scope="col" className="pb-1 pr-3 text-right font-normal">
                    Opening
                  </th>
                  <th scope="col" className="pb-1 pr-3 text-right font-normal">
                    Closing
                  </th>
                  <th scope="col" className="pb-1 text-right font-normal">
                    Tie-out
                  </th>
                </tr>
              </thead>
              <tbody>
                {tieOut.states.map((s) => (
                  <TieRow key={s.state} line={s} />
                ))}
                <TieRow line={tieOut.total} total />
              </tbody>
            </table>
          </div>
        ) : null}
        {adjustment && !isClosed ? (
          <p className="border-l-2 border-blue-500/60 pl-3 text-[13px] text-fg-2" data-testid="period-close-adjustment">
            <span className="text-fg-1">{priorPeriodLine(adjustment)}</span> Included in this month&apos;s roll-forward as its own line; the closed months keep their
            frozen figures.
          </p>
        ) : null}
        {isClosed && done?.closedBy ? (
          <p className="text-[13px] text-fg-1" data-testid="period-close-closed-by">
            Closed {fmtDate(done.demoDate)} by {done.closedBy}
          </p>
        ) : null}
        {isClosed && lateActivity ? (
          <p className="border-l-2 border-blue-500/60 pl-3 text-[13px] text-fg-2" data-testid="period-close-late">
            Since the close, {lateActivity.count} {lateActivity.count === 1 ? "row" : "rows"} dated in or before {label} arrived (
            <span className="num text-fg-1">{`${lateActivity.cents < 0 ? "−" : "+"}${usd(Math.abs(lateActivity.cents))}`}</span>
            ). {lateActivity.count === 1 ? "It posts" : "They post"} to {monthLabel(lateActivity.postedIn)} as a prior-period adjustment; the figures above stay as closed.
          </p>
        ) : null}
        {isClosed && done ? (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-xs text-fg-2" data-testid="period-close-closed">
            <Lock className="size-3.5 text-blue-300" strokeWidth={1.75} aria-hidden />
            Closed {label} · pack <span title={done.manifestSha256}>{short(done.manifestSha256)}</span> · chain #{done.chainSeq}
            {done.closedBy ? ` · by ${done.closedBy}` : ""}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3 sm:px-5">
        {isClosed ? (
          <a
            href={`/api/close-pack?period=${encodeURIComponent(period)}`}
            download
            data-testid="period-close-download"
            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line-hover px-3 text-[13px] text-fg-1 outline-none hover:border-blue-400 focus-visible:outline-2 focus-visible:outline-blue-400"
          >
            <Download className="size-3.5" strokeWidth={1.75} aria-hidden />
            Download the frozen pack
          </a>
        ) : preview && !blocked ? (
          <ApproveControl
            label={`Approve close of ${label}`}
            doneLabel={`${label} closed by a person`}
            request={(name) => closeRequest(period, name, preview.journalSha256)}
            testId="period-close-approve"
            onDone={(d) => setClosedNow({ chainSeq: Number(d.chainSeq ?? 0), manifestSha256: String(d.manifestSha256 ?? "") })}
          />
        ) : null}
      </div>
    </ActionCardFrame>
  );
}
