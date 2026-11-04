"use client";

import { useId } from "react";
import { Check, Download, Eye, EyeOff, FileText, TriangleAlert } from "lucide-react";
import { Money } from "@/components/primitives";
import { fmtIso } from "@/lib/close-out/derive";
import type { ReportFileView, RunnerLetterView } from "@/lib/close-out/runner-model";
import type { UnsentNotice } from "@/lib/reports/filing-record";
import { cn } from "@/lib/utils";

/**
 * R5-03: the exact letters an approve or send step acts on. Each row names the payee, check number and amount and opens
 * the stored draft exactly as composed (the preview route; sandboxed, no scripts). For approval, every letter must be
 * opened before the approve button unlocks; the server still binds the approval to each letter's content hash.
 */
export function LetterList({
  letters,
  opened,
  shown,
  onToggle,
  requireRead,
}: {
  letters: RunnerLetterView[];
  opened: ReadonlySet<string>;
  shown: string | null;
  onToggle: (outreachId: string) => void;
  requireRead: boolean;
}) {
  const read = letters.filter((l) => opened.has(l.outreachId)).length;
  return (
    <div className="mt-3 space-y-2" data-testid="runner-letters">
      {requireRead ? (
        <p className="text-xs text-pink-200" data-testid="runner-letters-read" data-read={read} data-total={letters.length}>
          Read {read} of {letters.length} {letters.length === 1 ? "letter" : "letters"}. Open each one to approve.
        </p>
      ) : null}
      <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-ink-1">
        {letters.map((l) => {
          const open = shown === l.outreachId;
          const seen = opened.has(l.outreachId);
          return (
            <li key={l.outreachId} data-testid="runner-letter" data-outreach-id={l.outreachId}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                <span className="min-w-0 flex-1 text-[13px] text-fg-1">
                  <span className="font-medium break-words">{l.payeeName}</span>
                  {l.checkNumber ? <span className="text-fg-2"> · check #{l.checkNumber}</span> : null}
                </span>
                <span className="num text-[13px] text-fg-1">
                  <Money cents={l.amountCents} />
                </span>
                <span className="font-mono text-[11px] text-fg-2" title={`Content hash ${l.contentSha256}`}>
                  {l.contentSha256.slice(0, 10)}
                </span>
                <button
                  type="button"
                  onClick={() => onToggle(l.outreachId)}
                  aria-expanded={open}
                  data-testid="runner-letter-read"
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line-hover px-2.5 text-[13px] text-fg-1 hover:border-blue-500 focus-visible:outline-2 focus-visible:outline-blue-400"
                >
                  {open ? <EyeOff className="size-3.5" aria-hidden /> : <Eye className="size-3.5" aria-hidden />}
                  {open ? "Hide letter" : seen ? "Read again" : "Read letter"}
                  {seen && !open ? (
                    <>
                      <Check className="size-3.5 text-blue-400" aria-hidden />
                      <span className="sr-only">(read)</span>
                    </>
                  ) : null}
                </button>
              </div>
              {open ? (
                <iframe
                  src={l.previewHref}
                  title={`Letter to ${l.payeeName}, exactly as it will go out`}
                  sandbox=""
                  className="block h-[28rem] w-full border-t border-line bg-white"
                  data-testid="runner-letter-preview"
                />
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** R5-04: the file the approval covers, before approving, and the unverified-rules acknowledgement. */
export function ReportFileSummary({
  file,
  unverifiedCount,
  unsentNotices,
  acknowledged,
  onAcknowledge,
  state,
}: {
  file: ReportFileView;
  unverifiedCount: number;
  unsentNotices: readonly UnsentNotice[];
  acknowledged: boolean;
  onAcknowledge: (v: boolean) => void;
  state: string;
}) {
  const id = useId();
  return (
    <div className="mt-3 space-y-3" data-testid="runner-file">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg border border-line bg-ink-1 px-3 py-2.5 text-[13px]">
        <dt className="text-fg-2">NAUPA file</dt>
        <dd className="text-fg-1">
          {file.itemCount} {file.itemCount === 1 ? "item" : "items"}, <Money cents={file.totalCents} />
        </dd>
        <dt className="text-fg-2">Checksum</dt>
        <dd className="font-mono text-[11px] break-all text-fg-1" data-testid="runner-file-checksum">
          {file.checksum}
        </dd>
        <dt className="sr-only">File</dt>
        <dd className="col-span-2 flex flex-wrap gap-x-4">
          <a href={file.fileHref} download data-testid="runner-file-link" className="inline-flex items-center gap-1 text-blue-400 underline-offset-2 hover:underline">
            <Download className="size-3.5" aria-hidden /> Download the file
          </a>
          <a href={`/reports?state=${state}`} className="inline-flex items-center gap-1 text-blue-400 underline-offset-2 hover:underline">
            <FileText className="size-3.5" aria-hidden /> Line items and validation in Reports
          </a>
        </dd>
      </dl>
      {unsentNotices.length > 0 ? <UnsentList notices={unsentNotices} /> : null}
      {unverifiedCount > 0 || unsentNotices.length > 0 ? (
        <div className="flex gap-2.5 rounded-lg border border-pink-700 bg-pink-900/40 px-3 py-2.5" data-testid="runner-ack">
          <input
            id={id}
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => onAcknowledge(e.target.checked)}
            className="mt-0.5 size-4 shrink-0 accent-pink-500"
            data-testid="runner-ack-box"
          />
          <label htmlFor={id} className="text-[13px] text-fg-1">
            <TriangleAlert className="mr-1 inline size-3.5 -translate-y-px text-pink-300" aria-hidden />
            Approve anyway:
            {unverifiedCount > 0 ? (
              <>
                {" "}
                this file relies on <span className="font-semibold">{unverifiedCount}</span> UNVERIFIED rule {unverifiedCount === 1 ? "value" : "values"} nobody has
                checked against the statute yet
              </>
            ) : null}
            {unverifiedCount > 0 && unsentNotices.length > 0 ? ", and" : null}
            {unsentNotices.length > 0 ? (
              <>
                {" "}
                <span className="font-semibold">{unsentNotices.length}</span> required due-diligence {unsentNotices.length === 1 ? "notice was" : "notices were"} never sent
              </>
            ) : null}
. The count you acknowledge is frozen on the filing record.
          </label>
        </div>
      ) : null}
    </div>
  );
}

/** R6-09: notices the rules required for items in this file that never went out. Pink: a person must own it. */
export function UnsentList({ notices }: { notices: readonly UnsentNotice[] }) {
  return (
    <ul className="space-y-1 rounded-lg border border-pink-700 bg-pink-900/30 px-3 py-2.5 text-[13px]" aria-label="Due-diligence notices never sent" data-testid="runner-unsent">
      {notices.map((x) => (
        <li key={x.staleItemId} className="flex flex-wrap items-baseline gap-x-2 text-fg-1">
          <span className="rounded-full border border-pink-600 px-1.5 text-[11px] font-medium text-pink-300">Not sent</span>
          <span className="font-medium">{x.payeeName}</span>
          <span className="num text-fg-2">
            <Money cents={x.amountCents} />
          </span>
          <span className="text-fg-2">
            {x.reason}
            {x.windowClosed ? `; window closed ${fmtIso(x.windowClosed)}` : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** R5-05: when and how the state was paid (outside the app). */
export function RemitFields({
  date,
  reference,
  maxDate,
  onChange,
}: {
  date: string;
  reference: string;
  maxDate: string;
  onChange: (v: { date: string; reference: string }) => void;
}) {
  const dateId = useId();
  const refId = useId();
  const field = "h-9 w-full rounded-md border border-pink-700 bg-ink-1 px-2.5 text-sm text-fg-1 outline-none hover:border-pink-500 focus-visible:border-pink-400";
  return (
    <div className="flex flex-wrap items-end gap-3" data-testid="runner-remit-fields">
      <div className="space-y-1">
        <label htmlFor={dateId} className="text-xs text-pink-200">
          Paid on
        </label>
        <input id={dateId} type="date" value={date} max={maxDate} onChange={(e) => onChange({ date: e.target.value, reference })} data-testid="runner-remit-date" className={cn(field, "sm:w-44")} />
      </div>
      <div className="space-y-1">
        <label htmlFor={refId} className="text-xs text-pink-200">
          Payment reference (optional)
        </label>
        <input
          id={refId}
          value={reference}
          maxLength={80}
          placeholder="e.g. wire or check number"
          onChange={(e) => onChange({ date, reference: e.target.value })}
          data-testid="runner-remit-ref"
          className={cn(field, "placeholder:text-fg-3 sm:w-60")}
        />
      </div>
    </div>
  );
}
