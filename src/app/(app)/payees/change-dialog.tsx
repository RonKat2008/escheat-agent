"use client";

import { useState, useTransition } from "react";
import { ArrowRight } from "lucide-react";
import { Money, STATUS_META } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatDate } from "@/lib/format";
import type { ChangePreview, ItemDiff, PayeeChange } from "@/lib/payees/review-types";
import { cn } from "@/lib/utils";
import { applyPayeeChangeAction, type ApplyResult } from "./actions";

export interface PendingChange {
  change: PayeeChange;
  /** null while the diff is being computed */
  preview: ChangePreview | null;
  error: string | null;
}

const KIND_TITLE: Record<PayeeChange["kind"], string> = {
  merge: "Merge payees",
  split: "Split alias into its own payee",
  rename: "Rename canonical name",
};

const statusLabel = (s: string) => STATUS_META[s]?.label ?? s;

function Change({ from, to, format = (v: string) => v }: { from: string | null; to: string | null; format?: (v: string) => string }) {
  const a = from ? format(from) : "Unknown";
  const b = to ? format(to) : "Unknown";
  if (a === b) return <span className="text-fg-2">{a}</span>;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span className="text-fg-3 line-through">{a}</span>
      <ArrowRight className="size-3 text-fg-3" aria-hidden />
      <span className="sr-only">changes to</span>
      <span className="font-medium text-fg-1">{b}</span>
    </span>
  );
}

function DiffRow({ d }: { d: ItemDiff }) {
  return (
    <tr data-testid="payee-diff-row" data-changed={d.changed || undefined} className="border-b border-line align-top">
      <td className="py-2 pr-3 font-mono text-xs text-fg-3">{d.checkNumber ? `#${d.checkNumber}` : "None"}</td>
      <td className="max-w-[160px] truncate py-2 pr-3 text-fg-2">{d.payeeNameRaw}</td>
      <td className="py-2 pr-3 text-right">
        <Money cents={d.amountCents} className="text-fg-1" />
      </td>
      <td className="py-2 pr-3">
        {d.ownerStateChanged ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-pink-500 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-black">
            {d.before.ownerState ?? "?"}
            <ArrowRight className="size-3" aria-hidden />
            <span className="sr-only">changes to</span>
            {d.after.ownerState ?? "?"}
          </span>
        ) : (
          <span className="text-fg-2">{d.after.ownerState ?? "Unknown"}</span>
        )}
      </td>
      <td className="py-2 pr-3">{d.closed ? <span className="text-fg-3">{statusLabel(d.before.status)} (closed, unchanged)</span> : <Change from={d.before.status} to={d.after.status} format={statusLabel} />}</td>
      <td className="py-2">{d.closed ? <span className="text-fg-3">None</span> : <Change from={d.before.reportDueDate} to={d.after.reportDueDate} format={(v) => formatDate(v)} />}</td>
    </tr>
  );
}

function DiffTable({ preview }: { preview: ChangePreview }) {
  if (preview.diffs.length === 0) {
    return (
      <p data-testid="payee-diff-empty" className="rounded-md border border-line bg-ink-1 p-3 text-sm text-fg-2">
        No items are affected. Only the payee record changes.
      </p>
    );
  }
  return (
    <div role="region" tabIndex={0} aria-label="Affected items, before and after" data-testid="payee-diff" className="overflow-x-auto rounded-md border border-line bg-ink-1 px-3">
      <table className="w-full min-w-[560px] text-[13px]">
        <thead>
          <tr className="border-b border-line text-left text-xs text-fg-3">
            <th scope="col" className="py-2 pr-3 font-normal">Check</th>
            <th scope="col" className="py-2 pr-3 font-normal">Ledger name</th>
            <th scope="col" className="py-2 pr-3 text-right font-normal">Amount</th>
            <th scope="col" className="py-2 pr-3 font-normal">Owner state</th>
            <th scope="col" className="py-2 pr-3 font-normal">Status</th>
            <th scope="col" className="py-2 font-normal">Report due</th>
          </tr>
        </thead>
        <tbody>
          {preview.diffs.map((d) => (
            <DiffRow key={d.staleItemId} d={d} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ChangeDialog({
  pending,
  onCancel,
  onApplied,
}: {
  pending: PendingChange | null;
  onCancel: () => void;
  onApplied: (res: Extract<ApplyResult, { ok: true }>, change: PayeeChange) => void;
}) {
  const [by, setBy] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();
  const preview = pending?.preview ?? null;
  const shownError = error ?? pending?.error ?? null;
  const nameOk = by.trim().length >= 2;

  function confirm() {
    if (!pending || !preview) return;
    setError(null);
    startTransition(async () => {
      const res = await applyPayeeChangeAction({ change: pending.change, by, fingerprint: preview.fingerprint });
      if (!res.ok) setError(res.error);
      else onApplied(res, pending.change);
    });
  }

  return (
    <Dialog
      open={pending !== null}
      onOpenChange={(o) => {
        if (!o && !busy) {
          setError(null);
          onCancel();
        }
      }}
    >
      <DialogContent className="max-h-[88dvh] overflow-y-auto sm:max-w-3xl" data-testid="payee-change-dialog">
        <DialogHeader>
          <DialogTitle>{pending ? KIND_TITLE[pending.change.kind] : "Payee change"}</DialogTitle>
          <DialogDescription>{preview?.summary ?? (pending?.error ? "This change cannot be previewed." : "Computing the effect on owner state…")}</DialogDescription>
        </DialogHeader>

        {preview ? (
          <div className="space-y-3">
            {preview.noop ? (
              <p className="text-sm text-fg-2">Nothing to change.</p>
            ) : (
              <>
                <p className="text-sm text-fg-2" data-testid="payee-diff-summary">
                  {preview.diffs.length} {preview.diffs.length === 1 ? "item" : "items"} move with this change
                  {preview.ownerStateChanges > 0 ? (
                    <>
                      , <span className="font-medium text-pink-300">{preview.ownerStateChanges} change owner state</span>
                    </>
                  ) : (
                    ", none change owner state"
                  )}
                  . Dates are recomputed by the rules engine from the new owner state; nothing is saved until you confirm.
                </p>
                <DiffTable preview={preview} />
                {preview.kind !== "rename" ? (
                  <p className="text-xs text-fg-3">
                    Resulting payee: <span className="text-fg-2">{preview.resultingCanonical}</span>
                    {preview.resultingAliases.length ? <> with aliases {preview.resultingAliases.join(", ")}</> : " with no aliases"}.
                  </p>
                ) : null}
                <label className="block text-[13px] text-fg-2">
                  <span className="mb-1 block">Your name (recorded with this change)</span>
                  <input
                    value={by}
                    onChange={(e) => setBy(e.target.value)}
                    maxLength={80}
                    autoComplete="name"
                    className="h-8 w-full rounded-md border border-line bg-ink-1 px-2.5 text-[13px] text-fg-1 outline-none placeholder:text-fg-3 hover:border-line-hover focus-visible:border-blue-400 sm:w-72"
                    placeholder="Reviewer name"
                  />
                </label>
              </>
            )}
          </div>
        ) : null}

        {shownError ? (
          <p role="alert" data-testid="payee-change-error" className={cn("rounded-md border border-pink-500/70 bg-pink-900/50 p-2.5 text-sm text-pink-300")}>
            {shownError}
          </p>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={busy} data-testid="payee-change-cancel">
            Cancel
          </Button>
          {preview && !preview.noop ? (
            <Button onClick={confirm} disabled={!nameOk || busy} data-testid="payee-change-confirm">
              {busy ? "Saving…" : "Confirm change"}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
