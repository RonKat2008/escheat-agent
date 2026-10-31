"use client";

import { CheckCircle2, ShieldQuestion } from "lucide-react";
import { SourceLink, UnknownBadge } from "@/components/primitives";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
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
              ? "No value yet, so dates that need it stay unknown."
              : "Check it against the sources below, then approve."}
        </span>
      </span>
    </p>
  );
}

/** Drawer body for one rule value: the full value, every source with its quote, research note and history. */
export function FieldDrawerBody({ row, state, version, sha256 }: { row: RuleRow; state: string; version: string; sha256: string }) {
  return (
    <div className="pb-8">
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
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <StatusLine row={row} />
          {row.approvable ? (
            <ApproveButton
              state={state}
              path={row.path}
              expectedVersion={version}
              expectedSha256={sha256}
              label="Approve value"
              subject={`${row.label.toLowerCase()} (${row.group})`}
              testId="approve-field-drawer"
            />
          ) : null}
        </div>
      </header>

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

      {row.todo ? (
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
