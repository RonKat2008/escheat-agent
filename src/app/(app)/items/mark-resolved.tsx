"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { ActionButton } from "@/components/b/ActionButton";
import { ApproverField, useApprover } from "@/components/b/ApproverField";
import { markResolvedPaidAction } from "./actions";

type FromStatus = Parameters<typeof markResolvedPaidAction>[0]["expectedStatus"];

/**
 * The only in-app way to close an item as paid. The holder has verified the payment (owner claims are unverified),
 * then confirms here; the server records an approval under the signed-in session.
 */
export function MarkResolved({ staleItemId, status }: { staleItemId: string; status: FromStatus }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [approver, setApprover] = useApprover();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function confirm() {
    setError(null);
    startTransition(async () => {
      const res = await markResolvedPaidAction({ staleItemId, expectedStatus: status, by: approver });
      if (!res.ok) return setError(res.error);
      toast.success("Marked resolved (paid).");
      setOpen(false);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <ActionButton variant="quiet" onClick={() => setOpen(true)} data-testid="mark-resolved-btn">
        <CheckCircle2 className="size-4" aria-hidden />
        Mark resolved (paid)
      </ActionButton>
    );
  }
  return (
    <div className="space-y-3 rounded-xl border border-border bg-sunken p-3" data-testid="mark-resolved-panel">
      <p className="text-xs leading-5 text-muted-foreground">
        Only confirm after you verified the payment (cleared in your bank, or reissued and cashed). This closes the item and removes it from reporting.
        It is recorded as an approval under your session.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <ApproverField value={approver} onChange={setApprover} className="w-full sm:w-52" />
        <ActionButton variant="approve" pending={pending} disabled={approver.trim().length < 2} onClick={confirm} data-testid="confirm-mark-resolved">
          Confirm: resolved (paid)
        </ActionButton>
        <ActionButton variant="quiet" onClick={() => setOpen(false)} disabled={pending}>
          Cancel
        </ActionButton>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
