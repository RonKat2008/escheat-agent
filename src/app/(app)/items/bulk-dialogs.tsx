"use client";

import Link from "next/link";
import { ActionButton } from "@/components/b/ActionButton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { StaleItemRow } from "@/lib/queries";
import { confirmLabel, type PlanPreview } from "./bulk-plan-view";
import type { BulkOutcome } from "./bulk-types";

const checkLabel = (n: string | null) => (n ? `#${n}` : "No check #");

interface BulkDialogsProps {
  preview: PlanPreview | null;
  outcomes: BulkOutcome<StaleItemRow>[] | null;
  busy: boolean;
  onClosePreview: () => void;
  onConfirm: () => void;
  onCloseOutcomes: () => void;
}

/** The dry-run preview and results dialogs of the bulk draft. Code-split: the Items table does not load the dialog primitive until a draft starts. */
export default function BulkDialogs({ preview, outcomes, busy, onClosePreview, onConfirm, onCloseOutcomes }: BulkDialogsProps) {
  const drafted = outcomes?.filter((o) => o.result.status === "drafted") ?? [];
  const notDrafted = outcomes?.filter((o) => o.result.status !== "drafted") ?? [];
  return (
  <>
    <Dialog open={preview !== null} onOpenChange={(o) => !o && !busy && onClosePreview()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg" data-testid="bulk-draft-preview">
        <DialogHeader>
          <DialogTitle>{preview?.title ?? "Preview"}</DialogTitle>
          <DialogDescription>Dry run: nothing has been written yet. Confirm to draft the letters below; they will wait in Approvals and nothing is sent.</DialogDescription>
        </DialogHeader>
        {preview && preview.groups.length > 0 ? (
          <div className="space-y-3" data-testid="bulk-skip-groups">
            {preview.groups.map((g) => (
              <section key={g.code} aria-label={`Skipped: ${g.label}`} data-testid="bulk-skip-group" data-code={g.code} className="rounded-md border border-line bg-ink-1 p-2.5">
                <h3 className="flex items-baseline justify-between gap-3 text-[13px] font-medium text-fg-1">
                  {g.label}
                  <span className="num text-xs font-normal text-fg-3">{g.entries.length} skipped</span>
                </h3>
                <ul className="mt-1.5 space-y-1">
                  {g.entries.map((e) => (
                    <li key={e.staleItemId} className="text-xs">
                      <span className="break-words text-fg-1">{e.payeeName}</span> <span className="font-mono text-fg-3">{checkLabel(e.checkNumber)}</span>
                      <p className="text-pink-400">{e.message}</p>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        ) : null}
        <DialogFooter>
          <ActionButton variant="quiet" onClick={() => onClosePreview()} disabled={busy} data-testid="bulk-preview-cancel">
            Cancel
          </ActionButton>
          <ActionButton variant="primary" pending={busy} disabled={!preview || preview.willDraft.length === 0} onClick={() => onConfirm()} data-testid="bulk-preview-confirm">
            {preview && preview.willDraft.length > 0 ? confirmLabel(preview.willDraft.length) : "Nothing to draft"}
          </ActionButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={outcomes !== null} onOpenChange={(o) => !o && onCloseOutcomes()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg" data-testid="bulk-draft-results">
        <DialogHeader>
          <DialogTitle>
            {drafted.length} drafted, {notDrafted.length} skipped
          </DialogTitle>
          <DialogDescription>Drafts wait in Approvals. Nothing has been sent.</DialogDescription>
        </DialogHeader>
        {notDrafted.length > 0 ? (
          <ul className="space-y-2" aria-label="Skipped items">
            {notDrafted.map(({ row, staleItemId, result }) => (
              <li key={staleItemId} className="rounded-md border border-line bg-ink-1 p-2.5">
                <p className="font-medium text-fg-1">
                  {row?.payeeName ?? "Unknown item"} {row ? <span className="font-mono text-xs text-fg-3">{checkLabel(row.checkNumber)}</span> : null}
                </p>
                <p className="text-xs text-pink-400">{result.status === "drafted" ? "" : result.reason}</p>
              </li>
            ))}
          </ul>
        ) : null}
        {drafted.some((o) => o.result.status === "drafted" && !o.result.ready) ? (
          <p className="text-xs text-fg-2">Some drafts are not ready to approve; their problems are listed in Approvals.</p>
        ) : null}
        <Link href="/approvals" className="text-[13px] text-blue-400 underline-offset-2 hover:text-blue-300 hover:underline">
          Review in approvals
        </Link>
      </DialogContent>
    </Dialog>
  </>
  );
}
