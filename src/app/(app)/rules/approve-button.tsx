"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCheck, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { approveRulesAction } from "./actions";

const KEY = "escheat.approver";

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
  variant?: "outline" | "default";
  size?: "sm" | "default";
  className?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [by, setBy] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function openDialog() {
    try {
      setBy((cur) => cur || (localStorage.getItem(KEY) ?? ""));
    } catch {
      /* storage unavailable */
    }
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
      router.refresh();
    });
  }

  return (
    <>
      <Button size={size} variant={variant} className={className} onClick={openDialog} data-testid={path ? "approve-field" : "approve-all"}>
        {path ? <ShieldCheck className="size-3.5" aria-hidden /> : <CheckCheck className="size-3.5" aria-hidden />}
        {label}
      </Button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={submit} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>Approve {subject}?</DialogTitle>
              <DialogDescription>
                You are confirming {count && count > 1 ? `${count} values` : "this value"} against the cited {state} source{count && count > 1 ? "s" : ""}. This saves a new rule version
                and recomputes every item&apos;s dates. It is recorded under your name and is not legal advice.
              </DialogDescription>
            </DialogHeader>
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">Approving as</span>
              <input
                value={by}
                onChange={(e) => setBy(e.target.value)}
                autoFocus
                required
                minLength={2}
                placeholder="Your full name"
                className="h-9 rounded-lg border border-input bg-sunken px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2"
              />
            </label>
            {error ? (
              <p role="alert" className="text-sm text-pink-400">
                {error}
              </p>
            ) : null}
            <DialogFooter className="gap-2 sm:justify-end">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending || by.trim().length < 2} data-testid="confirm-approve">
                {pending ? "Saving…" : "Approve and recompute"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
