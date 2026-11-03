"use client";

import { CheckCircle2, ShieldQuestion, SkipForward } from "lucide-react";
import { SourceLink, UnknownBadge } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ProvenanceGraph } from "@/components/viz/provenance/ProvenanceGraph";
import { AdoptionReview } from "./adoption-review";
import { ApproveButton } from "./approve-button";
import type { RuleRow } from "./rules-types";

const H3 = "mb-3 text-[13px] font-medium text-fg-1";
const SECTION = "border-t border-line px-5 py-5";

const day = (iso: string | null) => (iso ? formatDate(iso.slice(0, 10)) : null);

function StatusLine({ row }: { row: RuleRow }) {
  if (row.verified) {
    return (
      <p className="flex items-center gap-2 text-[13px] text-fg-2">
        <CheckCircle2 className="size-4 shrink-0 text-blue-500" strokeWidth={1.75} aria-hidden />
        <span>
          Verified{row.verifiedBy ? <> by {row.verifiedBy}</> : null}
          {row.verifiedAt ? <span className="text-fg-3">, {day(row.verifiedAt)}</span> : null}
        </span>
      </p>
    );
  }
  return (
    <p className="flex items-center gap-2 text-[13px] text-fg-2">
      <ShieldQuestion className="size-4 shrink-0 text-fg-3" strokeWidth={1.75} aria-hidden />
      <span>
        Unverified.{" "}
        <span className="text-fg-3">
          {row.reference
            ? "Reference only; no date depends on it."
            : row.value === null
              ? (row.status?.text ?? "No value yet, so dates that need it stay unknown.")
              : "Check it against the sources below, then approve."}
        </span>
      </span>
    </p>
  );
}

/** Step-through review context (F19): which unverified value this is, and how to move on. */
export interface ReviewContext {
  position: number;
  total: number;
  onSkip: (() => void) | null;
  onApproved: () => void;
}

/** Drawer body for one rule value: the full value, every source with its quote, research note and history. */
export function FieldDrawerBody({
  row,
  state,
  version,
  sha256,
  gateSuffix,
  review,
}: {
  row: RuleRow;
  state: string;
  version: string;
  sha256: string;
  gateSuffix: string | null;
  review: ReviewContext | null;
}) {
  return (
    <div className="pb-8">
      {review ? (
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-2.5 pr-14 text-xs text-fg-3" data-testid="review-progress">
          <span>
            Reviewing unverified value <span className="num text-fg-1">{review.position}</span> of <span className="num">{review.total}</span>
          </span>
          {review.onSkip ? (
            <Button size="sm" variant="ghost" onClick={review.onSkip} data-testid="review-skip">
              <SkipForward className="size-3.5" aria-hidden />
              Skip for now
            </Button>
          ) : null}
        </div>
      ) : null}
      <header className="px-5 pt-5 pb-5">
        <p className="pr-10 text-[13px] text-fg-3">
          {state} rules, {row.group}
        </p>
        <h2 className="mt-1.5 pr-10 text-xl leading-7 font-semibold tracking-[-0.015em] text-balance text-fg-1">{row.label}</h2>
        <div className="mt-4">
          {row.value === null ? (
            <UnknownBadge label="Unknown, no value researched" className="text-sm" />
          ) : (
            <p className={cn("text-lg leading-7 font-medium break-words text-fg-1", row.code && "font-mono text-base")}>{row.value}</p>
          )}
          {row.ownerText ? (
            <div className="mt-3 rounded-md border border-blue-700 bg-ink-1 p-3" data-testid="owner-text">
              <p className="text-xs text-fg-3">
                Above: the statute&apos;s requirement, never printed. Owner letters say (approved by {row.verifiedBy ?? "a reviewer"}):
              </p>
              <p className="mt-1 text-[13px] leading-5 break-words text-fg-1">{row.ownerText}</p>
            </div>
          ) : null}
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <StatusLine row={row} />
          {row.approvable ? (
            <ApproveButton
              state={state}
              path={row.path}
              expectedVersion={version}
              expectedSha256={sha256}
              label={review ? "Matches the source: approve" : "Approve value"}
              subject={`${row.label.toLowerCase()} (${row.group})`}
              testId="approve-field-drawer"
              gateSuffix={gateSuffix}
              variant={review ? "default" : "outline"}
              {...(review ? { onApproved: review.onApproved } : {})}
            />
          ) : null}
          {row.value === null && row.status?.kind === "official_text_found" ? (
            <AdoptionReview state={state} path={row.path} label={row.label} gateSuffix={gateSuffix} />
          ) : null}
        </div>
      </header>

      {row.reference ? null : (
        <section aria-label="Rule provenance" className={SECTION}>
          <ProvenanceGraph
            input={{
              state,
              rulePath: row.path,
              value: row.value,
              sources: row.sources,
              verified: row.verified,
              verifiedBy: row.verifiedBy,
              verifiedAt: row.verifiedAt,
            }}
          />
        </section>
      )}

      <section aria-labelledby="src-h" className={SECTION}>
        <h3 id="src-h" className={H3}>
          Sources <span className="num ml-1 font-normal text-fg-3">{row.sources.length}</span>
        </h3>
        {row.sources.length === 0 ? (
          <p className="text-[13px] text-fg-2">No source is cited for this value yet.</p>
        ) : (
          <ul className="space-y-4">
            {row.sources.map((s) => (
              <li key={s.url + s.quote} className="min-w-0">
                <SourceLink url={s.url} title={s.title} quote={s.quote} className="text-[13px]" />
                {s.title && s.title !== s.url ? <p className="mt-1 text-xs text-fg-3">{s.title}</p> : null}
                {s.quote ? (
                  <blockquote className="mt-2 border-l border-line-strong pl-3 text-[13px] leading-5 text-pretty break-words text-fg-2">
                    &ldquo;{s.quote}&rdquo;
                  </blockquote>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* The research note is written for reviewers; an unknown value shows the plain-language status above instead (R3-05). */}
      {row.todo && row.value !== null ? (
        <section aria-labelledby="todo-h" className={SECTION}>
          <h3 id="todo-h" className={H3}>
            Research note
          </h3>
          <p className="text-[13px] leading-5 text-pretty break-words text-fg-2">{row.todo}</p>
        </section>
      ) : null}

      <section aria-labelledby="fh-h" className={SECTION}>
        <h3 id="fh-h" className={H3}>
          History
        </h3>
        {row.history.length === 0 ? (
          <p className="text-[13px] text-fg-2">No saved versions include this value.</p>
        ) : (
          <ol className="border-t border-line">
            {row.history.map((h) => (
              <li key={h.version} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-0.5 border-b border-line py-2.5 text-[13px]">
                <span className="min-w-0 truncate font-mono text-xs text-fg-2" title={h.version}>
                  {h.version}
                  {h.current ? <span className="ml-2 font-sans text-fg-3">current</span> : null}
                </span>
                <span className="flex items-center gap-1.5 text-xs text-fg-3">
                  {h.verified ? (
                    <>
                      <CheckCircle2 className="size-3.5 text-blue-500" strokeWidth={1.75} aria-hidden />
                      {h.verifiedBy ? `Verified by ${h.verifiedBy}` : "Verified"}
                    </>
                  ) : (
                    <>
                      <ShieldQuestion className="size-3.5" strokeWidth={1.75} aria-hidden />
                      Unverified
                    </>
                  )}
                </span>
                <span className={cn("col-span-2 min-w-0 truncate", h.value === null ? "text-fg-3 italic" : "text-fg-1", row.code && h.value !== null && "font-mono")} title={h.value ?? undefined}>
                  {h.value ?? "Unknown"}
                </span>
              </li>
            ))}
          </ol>
        )}
        {row.history.length > 1 && row.history.every((h) => h.value === row.history[0]!.value && h.verified === row.history[0]!.verified) ? (
          <p className="mt-3 text-xs text-fg-3">Unchanged across every saved version.</p>
        ) : null}
      </section>

      <p className="px-5 pt-1 font-mono text-[11px] break-all text-fg-3">{row.path}</p>
    </div>
  );
}
