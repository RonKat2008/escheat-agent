"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CheckCircle2, CircleAlert } from "lucide-react";
import { ActionButton } from "@/components/b/ActionButton";
import { ApproverField, useApprover } from "@/components/b/ApproverField";
import { postJson } from "@/components/b/api";
import { Money } from "@/components/primitives";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { BULK_MAX } from "@/lib/outreach/bulk-limits";
import { notify } from "./notify";
import { plainBlockedReason } from "./plain-language";
import type { QueueData, QueueEntry } from "./queue-data";

type Channel = "letter" | "email" | "voice";

const ACTION: Record<Channel, string> = {
  letter: "Mail due-diligence letter",
  email: "Send due-diligence email",
  voice: "Place check-in call",
};
const PLURAL: Record<Channel, string> = { letter: "letters", email: "emails", voice: "calls" };
const SINGULAR: Record<Channel, string> = { letter: "letter", email: "email", voice: "call" };

/**
 * Recipient the server will be asked to approve for: letters go to the owner's address; email/voice need an
 * allowlisted target already on the draft. The allowlist is never used as a default (R3-16).
 */
export function recipientFor(entry: QueueEntry, env: QueueData["env"]): { label: string; to?: string; ok: boolean } {
  const o = entry.outreach!;
  if (o.channel === "letter") return { label: [o.ownerName, o.ownerAddress].filter(Boolean).join(", "), ok: o.hasOwnerAddress };
  const allow = o.channel === "email" ? env.allowedEmails : env.allowedPhones;
  const to = o.toAddress ?? "";
  const digits = (v: string) => v.replace(/\D/g, "");
  const listed = allow.some((a) => (o.channel === "voice" ? digits(a) === digits(to) && digits(to).length >= 8 : a.toLowerCase() === to.toLowerCase()));
  return { label: to || "No recipient chosen yet", to: to || undefined, ok: to.length > 0 && listed };
}

/** Why an entry cannot join a bulk approval, or null. */
export function bulkBlockReason(entry: QueueEntry, env: QueueData["env"]): string | null {
  const o = entry.outreach;
  if (!o) return "Reports, claims and rule changes are approved one at a time.";
  if (!["draft", "awaiting_approval"].includes(o.status)) return "Already handled.";
  if (!o.composed) return "Not composed yet. Compose it to check it.";
  if (!o.readiness.ready) return `Blocked: ${o.readiness.problems[0] ?? "fix the problems on the draft."}`;
  if (!recipientFor(entry, env).ok) return o.channel === "letter" ? "Blocked: no complete mailing address for the owner." : "Open it to choose an allowlisted recipient.";
  return null;
}

interface ItemResult {
  outreachId: string;
  ok: boolean;
  error?: string;
  /** Display-ready reason from the server when the item could not be approved. */
  blockedReason?: string;
}

export function BulkApproveBar({
  entries,
  env,
  onClear,
  onApproved,
  onBlocked,
}: {
  entries: QueueEntry[];
  env: QueueData["env"];
  onClear: () => void;
  onApproved: (keys: string[]) => void;
  /** Server-side block reasons per outreach id, shown inline on the queue rows (R2-04). */
  onBlocked?: (reasons: Record<string, string>) => void;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [approver, setApprover] = useApprover();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Map<string, ItemResult> | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  // The dialog keeps showing what was approved after the selection is cleared.
  const [snapshot, setSnapshot] = useState<QueueEntry[]>([]);

  const shown = open ? snapshot : entries;
  const channel = shown[0]?.outreach?.channel as Channel | undefined;
  const n = shown.length;
  const totalCents = entries.reduce((a, e) => a + (e.amountCents ?? 0), 0);

  function close() {
    setOpen(false);
    setResults(null);
    setFailure(null);
  }

  async function submit() {
    if (!channel) return;
    setBusy(true);
    setFailure(null);
    const r = await postJson<{ results: (ItemResult & { code?: string })[]; summary: { approved: number; failed: number } }>("/api/outreach/bulk-approve", {
      channel,
      approvedBy: approver.trim(),
      items: snapshot.map((e) => ({
        outreachId: e.outreach!.id,
        expectedContentSha256: e.outreach!.contentSha256,
        ...(channel !== "letter" ? { to: recipientFor(e, env).to } : {}),
      })),
    });
    setBusy(false);
    if (!r.ok) {
      setFailure(r.error);
      return;
    }
    setResults(new Map(r.data.results.map((x) => [x.outreachId, x])));
    const okKeys = snapshot.filter((e) => r.data.results.find((x) => x.outreachId === e.outreach!.id)?.ok).map((e) => e.key);
    onApproved(okKeys);
    onBlocked?.(Object.fromEntries(r.data.results.filter((x) => !x.ok).map((x) => [x.outreachId, plainBlockedReason(x.blockedReason ?? x.error ?? "")])));
    const { approved, failed } = r.data.summary;
    if (failed === 0) notify.success(`${approved} approval${approved === 1 ? "" : "s"} recorded`, { description: "Nothing was sent. Send each one from its detail view." });
    else notify.warning(`${approved} approved, ${failed} blocked`, { description: "Each blocked draft shows why in the list." });
    startTransition(() => router.refresh());
  }

  if (entries.length === 0 && !open) return null;
  const done = results !== null;

  return (
    <>
      {entries.length > 0 ? (
        <div
          role="region"
          aria-label="Bulk approval"
          data-testid="bulk-bar"
          className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-blue-800 bg-blue-900/90 px-4 py-2.5 text-[13px] backdrop-blur-md"
        >
          <p className="text-fg-1" aria-live="polite">
            <span className="num font-medium" data-testid="bulk-count">
              {entries.length}
            </span>{" "}
            selected, <span data-testid="bulk-total"><Money cents={totalCents} className="font-medium text-fg-1" /></span>
          </p>
          <div className="flex items-center gap-2">
            <ActionButton variant="quiet" onClick={onClear}>
              Clear
            </ActionButton>
            <ActionButton variant="primary" onClick={() => {
                setSnapshot(entries);
                setOpen(true);
              }} data-testid="bulk-approve">
              Approve {entries.length}
            </ActionButton>
          </div>
        </div>
      ) : null}

      <Dialog open={open} onOpenChange={(o) => !o && !busy && close()}>
        <DialogContent className="max-h-[88vh] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:max-w-xl" data-testid="bulk-approve-dialog">
          <DialogHeader>
            <DialogTitle>{done ? "Approvals recorded" : `Approve ${n} ${channel ? (n === 1 ? SINGULAR[channel] : PLURAL[channel]) : "items"}?`}</DialogTitle>
            <DialogDescription>
              {done
                ? "Nothing was sent, mailed or called. Send each approved item from its detail view."
                : "Each item gets its own approval, tied to exactly the content you reviewed. This does not send anything."}
            </DialogDescription>
          </DialogHeader>
          <ul className="min-h-0 space-y-2 overflow-y-auto" aria-label="Payloads to approve" data-testid="bulk-payloads">
            {shown.map((e) => {
              const o = e.outreach!;
              const res = results?.get(o.id);
              const rec = recipientFor(e, env);
              return (
                <li key={e.key} data-testid="bulk-payload" className="rounded-md border border-line bg-ink-1 p-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 text-[13px] font-medium break-words text-fg-1">{ACTION[o.channel]}</p>
                    {e.amountCents != null ? <Money cents={e.amountCents} className="shrink-0 text-[13px] text-fg-1" /> : null}
                  </div>
                  <p className="mt-0.5 text-xs break-words text-fg-2">
                    <span className="text-fg-3">To </span>
                    {rec.label}
                  </p>
                  <p className="mt-0.5 font-mono text-xs text-fg-3">content {o.contentSha256.slice(0, 12)}</p>
                  {res ? (
                    <p className={res.ok ? "mt-1 flex items-center gap-1.5 text-xs text-blue-400" : "mt-1 flex items-center gap-1.5 text-xs text-pink-400"}>
                      {res.ok ? <CheckCircle2 className="size-3.5" aria-hidden /> : <CircleAlert className="size-3.5" aria-hidden />}
                      {res.ok ? "Approval recorded" : plainBlockedReason(res.blockedReason ?? res.error ?? "")}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <div className="space-y-3">
            {failure ? (
              <p role="alert" className="text-xs text-pink-400">
                {failure}
              </p>
            ) : null}
            {done ? (
              <div className="flex justify-end">
                <ActionButton variant="quiet" onClick={close} data-testid="bulk-close">
                  Close
                </ActionButton>
              </div>
            ) : (
              <div className="flex flex-wrap items-end gap-3">
                <ApproverField value={approver} onChange={setApprover} className="w-full sm:w-52" />
                <div className="ml-auto flex gap-2">
                  <ActionButton variant="quiet" onClick={close} disabled={busy} data-testid="bulk-cancel">
                    Cancel
                  </ActionButton>
                  <ActionButton variant="approve" pending={busy} disabled={approver.trim().length === 0 || n > BULK_MAX} onClick={submit} data-testid="bulk-confirm">
                    Approve {n}
                  </ActionButton>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
