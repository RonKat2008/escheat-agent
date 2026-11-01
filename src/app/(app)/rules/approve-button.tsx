"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCheck, ShieldAlert, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { approveRulesAction } from "./actions";

const KEY = "escheat.approver";

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
  count,
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
  count?: number;
  variant?: "outline" | "default" | "ghost";
  size?: "sm" | "default";
  className?: string;
  /** Overrides the default test id (approve-field / approve-all), e.g. for the copy in the field drawer. */
  testId?: string;
  /** Set when the passcode gate is off: the exact suffix recorded after the name (shown, never silent). */
  gateSuffix?: string | null;
  /** Bulk approval: every value with its source, listed in the dialog; the reviewer must confirm they checked them. */
  listing?: ApprovalListItem[];
  /** Called after a successful approval (e.g. the review flow moves to the next value). */
  onApproved?: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [by, setBy] = useState("");
  const [attested, setAttested] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const listId = useId();
  const bulk = Boolean(listing && listing.length > 0);

  function openDialog() {
    try {
      setBy((cur) => cur || (localStorage.getItem(KEY) ?? ""));
    } catch {
      /* storage unavailable */
    }
    setAttested(false);
    setError(null);
    setOpen(true);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await approveRulesAction({ state, ...(path ? { path } : {}), by, expectedVersion, expectedSha256 });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      try {
        localStorage.setItem(KEY, by.trim());
      } catch {
        /* ignore */
      }
      toast.success(res.message, { description: `Saved as ${res.version}${res.transitions ? `; ${res.transitions} status changes` : ""}` });
      setOpen(false);
      onApproved?.();
      router.refresh();
    });
  }

  const name = by.trim() || "Your name";
  const canSubmit = !pending && by.trim().length >= 2 && (!bulk || attested);
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
                You are confirming {count && count > 1 ? `${count} values` : "this value"} against the cited {state} source{count && count > 1 ? "s" : ""}. This saves a new rule version
                and recomputes every item&apos;s dates. It is recorded under your name and is not legal advice.
              </DialogDescription>
            </DialogHeader>
            {bulk ? (
              <div className="grid gap-2">
                <p id={listId} className="text-[13px] text-fg-2">
                  Every value below will be marked verified. Check each one against its source first; reviewing them one at a time is safer.
                </p>
                <ul aria-labelledby={listId} data-testid="approve-all-list" className="max-h-[40vh] min-w-0 overflow-y-auto rounded-lg border border-line text-[13px]">
                  {listing!.map((v) => (
                    <li key={v.path} className="grid min-w-0 gap-0.5 border-b border-line px-3 py-2 last:border-b-0">
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
                <label className="flex items-start gap-2 text-[13px] text-fg-1">
                  <input
                    type="checkbox"
                    checked={attested}
                    onChange={(e) => setAttested(e.target.checked)}
                    className="mt-0.5 size-4 shrink-0 accent-blue-500"
                    data-testid="approve-all-attest"
                  />
                  <span>I checked each of these {listing!.length} values against its source.</span>
                </label>
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
                className="h-9 rounded-lg border border-input bg-sunken px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2"
              />
            </label>
            {gateSuffix ? (
              <p role="note" data-testid="gate-disabled-note" className="flex gap-2 rounded-lg border border-pink-500/40 px-3 py-2 text-[13px] text-fg-1">
                <ShieldAlert className="mt-0.5 size-4 shrink-0 text-pink-400" strokeWidth={1.75} aria-hidden />
                <span>
                  The passcode gate is off (local development), so this approval is not tied to a signed-in session. It will be recorded as{" "}
                  <span className="font-medium break-words">
                    &ldquo;{name} {gateSuffix}&rdquo;
                  </span>
                  . Set APP_PASSCODE to record a session instead.
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
                {pending ? "Saving…" : bulk ? `Approve ${listing!.length} values and recompute` : "Approve and recompute"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
