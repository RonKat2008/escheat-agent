"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCheck, ShieldAlert, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useApprover } from "@/components/b/ApproverField";
import { approveRulesAction } from "./actions";
import { canApprove } from "./adoption-model";

/** One value as listed in the bulk-approval confirm dialog (F19): what is approved and the source it rests on. */
export interface ApprovalListItem {
  path: string;
  label: string;
  group: string;
  value: string;
  source: { url: string; title: string } | null;
}

/** Confirm dialog for a human rule approval. Asks for the approver's name; calls the server action. */
export function ApproveButton({
  state,
  path,
  expectedVersion,
  expectedSha256,
  label,
  subject,
  variant = "outline",
  size = "sm",
  className,
  testId,
  gateSuffix = null,
  listing,
  onApproved,
}: {
  state: string;
  path?: string;
  /** Rule file version + sha256 as rendered on this page; the server rejects the approval if the file changed since. */
  expectedVersion: string;
  expectedSha256: string;
  label: string;
  /** what is being approved, shown in the dialog */
  subject: string;
  variant?: "outline" | "default" | "ghost";
  size?: "sm" | "default";
  className?: string;
  /** Overrides the default test id (approve-field / approve-all), e.g. for the copy in the field drawer. */
  testId?: string;
  /** Set when the passcode gate is off: the exact suffix recorded after the name (shown, never silent). */
  gateSuffix?: string | null;
  /**
   * Several values (R4-20): every value with its source is listed with its own checkbox, none ticked. Only the values the
   * reviewer ticks one by one are sent, by path; there is no "approve everything" request.
   */
  listing?: ApprovalListItem[];
  /** Called after a successful approval (e.g. the review flow moves to the next value). */
  onApproved?: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // F33: one approver identity everywhere (Approvals, Reports, Recoveries prefill the same remembered name).
  const [by, setBy] = useApprover();
  const [checked, setChecked] = useState<ReadonlySet<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const listId = useId();
  const bulk = Boolean(listing && listing.length > 0);

  function openDialog() {
    setChecked(new Set());
    setError(null);
    setOpen(true);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const target = path ? { path } : { paths: [...checked] };
      const res = await approveRulesAction({ state, ...target, by, expectedVersion, expectedSha256 });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      toast.success(res.message, { description: `Saved as ${res.version}${res.transitions ? `; ${res.transitions} status changes` : ""}` });
      setOpen(false);
      onApproved?.();
      router.refresh();
    });
  }

  const nameOk = canApprove(by);
  const canSubmit = !pending && nameOk && (!bulk || checked.size > 0);
  const toggle = (p: string, on: boolean) =>
    setChecked((cur) => {
      const next = new Set(cur);
      if (on) next.add(p);
      else next.delete(p);
      return next;
    });
  return (
    <>
      <Button size={size} variant={variant} className={className} onClick={openDialog} data-testid={testId ?? (path ? "approve-field" : "approve-all")}>
        {path ? <ShieldCheck className="size-3.5" aria-hidden /> : <CheckCheck className="size-3.5" aria-hidden />}
        {label}
      </Button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent className={bulk ? "sm:max-w-2xl" : "sm:max-w-md"}>
          <form onSubmit={submit} className="grid min-w-0 gap-4">
            <DialogHeader>
              <DialogTitle>Approve {subject}?</DialogTitle>
              <DialogDescription>
                {bulk
                  ? `Tick each ${state} value only after you have checked it against its cited source. Only ticked values are approved.`
                  : `You are confirming this value against the cited ${state} source.`}{" "}
                This saves a new rule version and recomputes every item&apos;s dates. It is recorded under your name and is not legal advice.
              </DialogDescription>
            </DialogHeader>
            {bulk ? (
              <div className="grid gap-2">
                <p id={listId} className="text-[13px] text-fg-2">
                  Nothing is ticked for you. Reviewing one value at a time in the drawer is safer.
                </p>
                <ul aria-labelledby={listId} data-testid="approve-all-list" className="max-h-[40vh] min-w-0 overflow-y-auto rounded-lg border border-line text-[13px]">
                  {listing!.map((v) => (
                    <li key={v.path} className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-2.5 gap-y-0.5 border-b border-line px-3 py-2 last:border-b-0">
                      <input
                        type="checkbox"
                        checked={checked.has(v.path)}
                        onChange={(e) => toggle(v.path, e.target.checked)}
                        className="row-span-3 mt-0.5 size-4 shrink-0 accent-blue-500"
                        data-testid="approve-all-check"
                        aria-label={`I checked ${v.label} (${v.group}) against its source`}
                      />
                      <span className="min-w-0 text-xs text-fg-3">
                        {v.group} · {v.label}
                      </span>
                      <span className="min-w-0 break-words font-medium text-fg-1">{v.value}</span>
                      {v.source ? (
                        <a href={v.source.url} target="_blank" rel="noopener noreferrer" className="min-w-0 truncate text-xs text-blue-400 underline decoration-blue-400/30 underline-offset-2 hover:text-blue-300">
                          {v.source.title || v.source.url}
                        </a>
                      ) : (
                        <span className="text-xs text-pink-400">No source cited</span>
                      )}
                    </li>
                  ))}
                </ul>
                <p className="text-[13px] text-fg-3" data-testid="approve-all-count" aria-live="polite">
                  {checked.size} of {listing!.length} ticked
                </p>
              </div>
            ) : null}
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">Approving as</span>
              <input
                value={by}
                onChange={(e) => setBy(e.target.value)}
                autoFocus={!bulk}
                required
                minLength={2}
                placeholder="Your full name"
                aria-describedby={nameOk ? undefined : `${listId}-name`}
                className="h-9 rounded-lg border border-input bg-sunken px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2"
              />
            </label>
            {!nameOk ? (
              <p id={`${listId}-name`} className="-mt-2 text-[13px] text-pink-400" data-testid="approver-required">
                Enter your name (2 or more characters) to approve. It is recorded on the approval and the new rule version.
              </p>
            ) : null}
            {gateSuffix ? (
              <p role="note" data-testid="gate-disabled-note" className="flex gap-2 rounded-lg border border-pink-500/40 px-3 py-2 text-[13px] text-fg-1">
                <ShieldAlert className="mt-0.5 size-4 shrink-0 text-pink-400" strokeWidth={1.75} aria-hidden />
                <span>
                  No sign-in is configured: the name you type is recorded as typed in this browser session. Set APP_PASSCODE to record a session instead.
                </span>
              </p>
            ) : null}
            {error ? (
              <p role="alert" className="text-sm text-pink-400">
                {error}
              </p>
            ) : null}
            <DialogFooter className="gap-2 sm:justify-end">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" disabled={!canSubmit} data-testid="confirm-approve">
                {pending ? "Saving…" : bulk ? `Approve ${checked.size} ticked value${checked.size === 1 ? "" : "s"}` : "Approve and recompute"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
