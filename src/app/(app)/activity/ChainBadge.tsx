"use client";

import { Download, Link2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface ChainBadgeProps {
  ok: boolean;
  length: number;
  headHash: string;
  firstBrokenSeq?: number;
  reason?: string;
}

const short = (h: string) => `${h.slice(0, 4)}…${h.slice(-4)}`;

/** The badge's visible label, shared with tests. */
export function chainBadgeLabel(p: Pick<ChainBadgeProps, "ok" | "length" | "headHash" | "firstBrokenSeq">): string {
  if (!p.ok) return `Chain broken at #${p.firstBrokenSeq ?? "?"}`;
  return `Chain verified · ${p.length} ${p.length === 1 ? "event" : "events"} · head ${short(p.headHash)}`;
}

/**
 * "Chain verified · N events · head 3f9a…c21e". Blue when every hash recomputes; neutral text when it does not (nobody
 * has an action to take, so it is not pink). Opens a popover that says what the check covers and offers the JSON.
 */
export function ChainBadge(p: ChainBadgeProps) {
  const label = chainBadgeLabel(p);
  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            data-testid="audit-chain-badge"
            data-ok={p.ok ? "true" : "false"}
            data-length={p.length}
            data-head={p.headHash}
            aria-label={`${label}. Open details`}
            className={cn(
              "inline-flex h-7 max-w-full min-w-0 items-center gap-1.5 rounded-full border px-2.5 text-xs whitespace-nowrap transition-colors duration-150 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400",
              p.ok
                ? "border-blue-700 bg-blue-950/40 text-blue-300 hover:border-blue-500 hover:text-blue-200 aria-expanded:border-blue-500"
                : "border-line-hover text-fg-2 hover:bg-ink-2 hover:text-fg-1 aria-expanded:bg-ink-2",
            )}
          />
        }
      >
        <Link2 aria-hidden className="size-3.5 shrink-0" strokeWidth={1.75} />
        <span className="num truncate">{label}</span>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 max-w-[calc(100vw-32px)]" data-testid="audit-chain-popover">
        <PopoverTitle>Audit chain</PopoverTitle>
        <div className="mt-2 space-y-2 text-[13px] text-fg-2">
          <p>
            Every clock move, approval, sent letter, report, remittance, rule approval and recovery claim is stored as its own row, written in the
            same transaction as the change. Each row holds the sha256 of the row before it.
          </p>
          <p>
            The check recomputes all <span className="num text-fg-1">{p.length}</span> hashes in order. An edited, deleted or reordered row breaks it.
            It does not cover events that were never recorded, or agent runs (they are on the Runs page).
          </p>
          {p.ok ? (
            <p className="text-fg-1">
              Head <span className="num break-all text-blue-300">{p.headHash}</span>
            </p>
          ) : (
            <p className="text-fg-1" data-testid="audit-chain-reason">
              {p.reason ?? `The chain stops checking out at row #${p.firstBrokenSeq}.`}
            </p>
          )}
        </div>
        <a
          href="/api/audit/chain"
          download
          data-testid="audit-chain-download"
          className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-md border border-line-hover px-2.5 text-[13px] text-fg-1 transition-colors duration-150 hover:bg-ink-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400"
        >
          <Download aria-hidden className="size-3.5" strokeWidth={1.75} />
          Download chain (JSON)
        </a>
      </PopoverContent>
    </Popover>
  );
}
