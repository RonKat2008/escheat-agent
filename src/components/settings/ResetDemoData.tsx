"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DatabaseBackup } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/lib/toast";

interface Availability {
  available: boolean;
  reason: string | null;
}

/**
 * "Reset demo data": reseeds the synthetic demo database on the server (POST /api/demo/reset). Whether it may run is
 * decided by the server (demo mode and the local PGlite database only); this just asks and disables the button with
 * the reason. A confirm dialog comes first because it wipes approvals, filings and everything else the demo changed.
 */
export function ResetDemoData({ variant = "row", onDone }: { variant?: "row" | "compact"; onDone?: () => void }) {
  const router = useRouter();
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  useEffect(() => {
    let live = true;
    fetch("/api/demo/reset")
      .then((r) => (r.ok ? (r.json() as Promise<Availability>) : { available: false, reason: "Could not check whether a reset is allowed." }))
      .catch(() => ({ available: false, reason: "Could not check whether a reset is allowed." }))
      .then((a) => live && setAvailability(a));
    return () => {
      live = false;
    };
  }, []);

  async function reset() {
    setBusy(true);
    try {
      const res = await fetch("/api/demo/reset", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirm: true }) });
      const json = (await res.json()) as { error?: string; items?: number; problems?: string[] };
      if (!res.ok) throw new Error(json.error ?? `Reset failed (${res.status})`);
      if (json.problems?.length) throw new Error(`Reseeded, but the demo numbers are off: ${json.problems.join("; ")}`);
      setOpen(false);
      toast.success("Demo data reset", { description: `${json.items} stale items are back, with no approvals or filings.` });
      onDone?.();
      startTransition(() => router.refresh());
    } catch (e) {
      toast.error("Could not reset the demo data", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  const disabled = !availability?.available;
  const reason = availability && !availability.available ? availability.reason : null;
  const compact = variant === "compact";

  return (
    <div data-testid="reset-demo" className={compact ? "" : "flex flex-wrap items-start justify-between gap-x-6 gap-y-3"}>
      {compact ? null : (
        <div className="min-w-0 flex-1 basis-64">
          <h3 className="text-sm font-medium text-fg-1">Reset demo data</h3>
          <p className="mt-1 max-w-prose text-[13px] leading-5 text-fg-2">
            Reseeds the synthetic company from scratch: 47 stale items, no approvals, filings or owner replies, the demo clock back at the start.
          </p>
        </div>
      )}
      <Button
        size="sm"
        variant={compact ? "ghost" : "outline"}
        disabled={disabled}
        onClick={() => setOpen(true)}
        className={compact ? "w-full justify-start" : undefined}
        data-testid="reset-demo-open"
      >
        <DatabaseBackup className="size-3.5" aria-hidden />
        Reset demo data
      </Button>
      {reason ? (
        <p className={compact ? "mt-1.5 text-xs text-fg-3" : "basis-full text-xs text-fg-3"} data-testid="reset-demo-unavailable">
          {reason}
        </p>
      ) : null}
      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Reset demo data?</DialogTitle>
            <DialogDescription>
              This wipes every approval, filing, letter and owner reply in the demo database and reseeds the synthetic company. It cannot be undone. Nothing is
              sent anywhere.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={busy} onClick={() => void reset()} data-testid="reset-demo-confirm">
              {busy ? "Resetting…" : "Reset demo data"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
