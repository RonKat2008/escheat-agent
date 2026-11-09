"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Archive, Lock } from "lucide-react";
import { ActionButton } from "@/components/b/ActionButton";
import { ApproverField, useApprover } from "@/components/b/ApproverField";
import { postJson } from "@/components/b/api";
import { buttonVariants } from "@/components/ui/button";
import { isValidApproverName } from "@/lib/auth/approver";
import { formatDate } from "@/lib/format";
import { formatUSD } from "@/lib/money";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

export interface MonthOption {
  id: string;
  label: string;
}

/** What closing an open month would freeze (computed on the server; the server re-checks it on close). */
export interface ClosePreviewView {
  entryCount: number;
  journalSha256: string;
  closingCents: number;
  notOver: boolean;
  coversThrough: string;
  /** R11-04: why the month cannot be closed yet (months close in order), or null. */
  blocked: string | null;
}

export interface ClosedView {
  manifestSha256: string;
  chainSeq: number;
  closedBy: string;
  demoDate: string;
  /** R11-01: the figures frozen at close (null for a close recorded before they were stored). */
  frozen: { openingCents: number; closingCents: number; allTie: boolean } | null;
}

const short = (hash: string) => `${hash.slice(0, 4)}…`;

/**
 * "Close pack": pick a month with activity, download the month-end ZIP (blue: nobody has to act). Next to it, "Close
 * <Month>" (R10-01): the irreversible step, behind a typed-name approval the server binds to the journal shown here.
 * A closed month shows "Closed <Month> · pack 3f9a… · chain #21", then "Closed <date> by <name>" with the figures frozen
 * at close (never live totals, R11-01), and its pack downloads byte-identical. Months close in order (R11-04): the
 * selector opens on the next closable month, and any other open month explains which month to close first.
 */
export function ClosePackButton({
  months,
  previews = {},
  closed = {},
  defaultMonth,
}: {
  months: readonly MonthOption[];
  previews?: Record<string, ClosePreviewView>;
  closed?: Record<string, ClosedView>;
  /** The month to open on (the next closable month); the newest month when absent. */
  defaultMonth?: string;
}) {
  const router = useRouter();
  const [month, setMonth] = useState((defaultMonth && months.some((m) => m.id === defaultMonth) ? defaultMonth : months[0]?.id) ?? "");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [approver, setApprover] = useApprover();
  const [pending, startTransition] = useTransition();
  const label = months.find((m) => m.id === month)?.label ?? month;
  const done = closed[month];
  const preview = previews[month];

  async function download() {
    if (busy || !month) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/close-pack?period=${encodeURIComponent(month)}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        toast.error("Close pack failed", { description: body?.error ?? `HTTP ${res.status}` });
        return;
      }
      const blob = await res.blob();
      const files = res.headers.get("x-close-pack-files");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `escheat-close-pack-${month}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
      toast.info(`Close pack downloaded: ${files ?? "6"} files`, { description: "Journal, roll-forward, audit binder, Activity, tie-out and manifest." });
    } catch {
      toast.error("Close pack failed", { description: "The download could not complete." });
    } finally {
      setBusy(false);
    }
  }

  function confirmClose() {
    if (!preview) return;
    setError(null);
    startTransition(async () => {
      const r = await postJson<{ chainSeq: number }>("/api/close-pack", { period: month, approvedBy: approver, expectedJournalSha256: preview.journalSha256 });
      if (!r.ok) return setError(r.error);
      toast.success(`${label} closed`, { description: `Recorded in the audit chain at #${r.data.chainSeq}.` });
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <div id="close-pack" className="flex scroll-mt-24 flex-wrap items-center gap-2" data-testid="close-pack">
      <label className="sr-only" htmlFor="close-pack-month">
        Close pack month
      </label>
      <select
        id="close-pack-month"
        data-testid="close-pack-month"
        value={month}
        onChange={(e) => {
          setMonth(e.target.value);
          setOpen(false);
          setError(null);
        }}
        className="h-9 rounded-md border border-line-hover bg-ink-2 px-2 text-sm text-fg-1 focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:outline-none"
      >
        {months.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => void download()}
        disabled={busy || !month}
        data-testid="close-pack-button"
        className={cn(buttonVariants({ variant: "outline" }), "h-9 gap-1.5")}
      >
        <Archive className="size-4" strokeWidth={1.75} aria-hidden />
        {busy ? "Building…" : "Close pack"}
      </button>
      {done ? (
        <p data-testid="close-status" className="flex items-center gap-1.5 font-mono text-xs text-fg-2">
          <Lock className="size-3.5 text-blue-300" strokeWidth={1.75} aria-hidden />
          <span>
            Closed {label} · pack <span title={done.manifestSha256}>{short(done.manifestSha256)}</span> · chain #{done.chainSeq}
          </span>
        </p>
      ) : preview?.blocked ? (
        <button
          type="button"
          disabled
          aria-describedby="close-month-blocked"
          data-testid="close-month-open"
          className={cn(buttonVariants({ variant: "outline" }), "h-9 gap-1.5")}
        >
          <Lock className="size-4" strokeWidth={1.75} aria-hidden />
          Close {label}
        </button>
      ) : preview ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          data-testid="close-month-open"
          className={cn(buttonVariants({ variant: "outline" }), "h-9 gap-1.5")}
        >
          <Lock className="size-4" strokeWidth={1.75} aria-hidden />
          Close {label}
        </button>
      ) : null}
      {done ? (
        <p data-testid="close-frozen" className="w-full text-xs text-fg-2">
          Closed {formatDate(done.demoDate)} by <span className="text-fg-1">{done.closedBy}</span>
          {done.frozen ? (
            <>
              {" "}
              · frozen at close: opening <span className="num text-fg-1">{formatUSD(done.frozen.openingCents)}</span>, closing{" "}
              <span className="num text-fg-1" data-testid="close-frozen-closing" data-cents={done.frozen.closingCents}>
                {formatUSD(done.frozen.closingCents)}
              </span>
              {done.frozen.allTie ? ", every state tied" : ", some states did not tie"}. Later activity dated in {label} posts to the next open month.
            </>
          ) : null}
        </p>
      ) : preview?.blocked ? (
        <p id="close-month-blocked" data-testid="close-month-blocked" className="w-full max-w-[62ch] text-xs text-fg-2">
          {preview.blocked}
        </p>
      ) : null}
      {open && preview && !preview.blocked && !done ? (
        <section aria-label={`Close ${label}`} data-testid="close-month-panel" className="w-full max-w-[62ch] space-y-3 rounded-xl border border-pink-500/50 bg-ink-2 p-4 text-left">
          <p className="text-sm text-fg-2">
            Closing {label} freezes its {preview.entryCount} journal {preview.entryCount === 1 ? "entry" : "entries"} (closing liability {formatUSD(preview.closingCents)}) and
            writes the close pack&apos;s manifest hash into the audit chain. It cannot be undone. Items detected later but dated inside {label} then post to the next open
            month as labelled prior-period adjustments. Nothing is posted to an accounting system.
          </p>
          {preview.notOver ? (
            <p data-testid="close-month-not-over" className="text-sm text-pink-300">
              {label} is not over on the demo clock: this close covers through {formatDate(preview.coversThrough)}. Anything dated later in {label} will post to the next month.
            </p>
          ) : null}
          <div className="flex flex-wrap items-end gap-3">
            <ApproverField value={approver} onChange={setApprover} className="w-full sm:w-52" />
            <ActionButton variant="approve" pending={pending} disabled={!isValidApproverName(approver)} onClick={confirmClose} data-testid="close-month-confirm">
              Confirm close of {label}
            </ActionButton>
            <ActionButton variant="quiet" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </ActionButton>
          </div>
          {error ? (
            <p role="alert" className="text-sm text-pink-400" data-testid="close-month-error">
              {error}
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
