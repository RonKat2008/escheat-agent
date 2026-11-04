"use client";

import { useId, useState } from "react";
import { ActionButton } from "@/components/b/ActionButton";
import { ApiProblem } from "@/components/b/ApiProblem";
import { postJson, type ApiFailure } from "@/components/b/api";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { isValidApproverName } from "@/lib/auth/approver";
import { REJECT_REASON_MIN_CHARS } from "@/lib/outreach/reject-limits";
import { notify } from "./notify";

/**
 * R6-20a: discard a draft that will not be sent (blocked, wrong, or not wanted). Needs the typed approver name above
 * and a reason; a confirm dialog states what happens. Server: POST /api/outreach/[id]/reject.
 */
export function DiscardDraft({ outreachId, approver, disabled, onDone }: { outreachId: string; approver: string; disabled: boolean; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const reasonId = useId();
  const nameOk = isValidApproverName(approver);
  const reasonOk = reason.trim().length >= REJECT_REASON_MIN_CHARS;

  async function discard() {
    setBusy(true);
    setFailure(null);
    const r = await postJson(`/api/outreach/${outreachId}/reject`, { rejectedBy: approver.trim(), reason: reason.trim() });
    setBusy(false);
    if (!r.ok) return setFailure(r);
    setOpen(false);
    setReason("");
    notify.success("Draft discarded", { description: "Nothing was sent. The item can get a new draft." });
    onDone();
  }

  return (
    <>
      <ActionButton variant="quiet" disabled={disabled} onClick={() => setOpen(true)} data-testid="discard-btn">
        Discard draft
      </ActionButton>
      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent className="sm:max-w-md" data-testid="discard-dialog">
          <DialogHeader>
            <DialogTitle>Discard this draft?</DialogTitle>
            <DialogDescription>
              The draft is cancelled and nothing is sent. Your name and reason are recorded on it. The item stays open and can get a new draft.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <label htmlFor={reasonId} className="text-xs text-fg-3">
              Reason
            </label>
            <textarea
              id={reasonId}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={500}
              data-testid="discard-reason"
              className="rounded-lg border border-input bg-sunken px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2"
              placeholder="Why is this draft not being sent?"
            />
            {!nameOk ? <p className="text-[13px] text-pink-400">Enter your name (2 or more characters) in the approver field first.</p> : null}
          </div>
          {failure ? <ApiProblem failure={failure} /> : null}
          <DialogFooter className="gap-2 sm:justify-end">
            <ActionButton variant="quiet" onClick={() => setOpen(false)} disabled={busy}>
              Keep draft
            </ActionButton>
            <ActionButton variant="primary" pending={busy} disabled={!nameOk || !reasonOk} onClick={discard} data-testid="discard-confirm">
              Discard draft
            </ActionButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
