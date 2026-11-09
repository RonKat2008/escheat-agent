"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { Check, CircleCheck } from "lucide-react";
import { getJson, postJson } from "@/components/b/api";
import { useApprover } from "@/components/b/ApproverField";
import { PRIMARY } from "@/components/ui/button";
import { isValidApproverName } from "@/lib/auth/approver";
import type { ApprovalRequest } from "@/lib/ask/cards/approval-request";
import type { CardApproval } from "@/lib/ask/cards/approval-ui-types";
import { cn } from "@/lib/utils";

/**
 * The human half of every Ask approval card: a typed name, an optional "approve anyway" acknowledgement, and a coral
 * button. The click POSTs `request(name, acknowledged)` (built by src/lib/ask/cards/approval-request.ts, the same
 * endpoint and body as the matching page) and nothing else: no POST on mount or in an effect. The server re-checks the
 * session, the name and the hash; a refusal (409 on changed content, missing acknowledgement) is shown verbatim and the
 * row stays unapproved.
 *
 * R11-02: with `statusOf`, the control first reads the row's CURRENT approval state from the server (a GET, never a
 * POST), so a card restored from session storage shows "Approved by <name>" instead of a second Approve button. A 409
 * already_approved from the server reads "Already approved by <name>", not an error.
 */
/** The read-only status endpoint for a card row (src/app/api/approvals/status/route.ts). */
export function approvalStatusUrl(a: CardApproval): string {
  const id = a.kind === "outreach" ? a.outreachId : a.kind === "report" ? a.reportId : a.recoveryId;
  return `/api/approvals/status?kind=${a.kind}&id=${encodeURIComponent(id)}`;
}

type Status = { phase: "checking" } | { phase: "open" } | { phase: "done"; text: string };

export function ApproveControl({
  label,
  request,
  acknowledge,
  doneLabel = "Approved by a person",
  testId = "card-approve",
  onDone,
  statusOf,
}: {
  label: string;
  request: (approvedBy: string, acknowledged: boolean) => ApprovalRequest;
  /** "Approve anyway" text; the box must be ticked before the button enables. */
  acknowledge?: ReactNode;
  doneLabel?: string;
  testId?: string;
  onDone?: (data: Record<string, unknown>) => void;
  /** The row this control approves: its current server state is read on mount (R11-02). */
  statusOf?: CardApproval;
}) {
  const [approver, setApprover] = useApprover();
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const statusUrl = statusOf ? approvalStatusUrl(statusOf) : null;
  const [status, setStatus] = useState<Status>(statusUrl ? { phase: "checking" } : { phase: "open" });
  useEffect(() => {
    if (!statusUrl) return;
    let live = true;
    void getJson<{ approved?: boolean; approvedBy?: string | null }>(statusUrl).then((r) => {
      if (!live) return;
      // A failed read leaves the button usable: the server still refuses a second approval with 409.
      setStatus(r.ok && r.data.approved ? { phase: "done", text: `Approved by ${r.data.approvedBy ?? "a person"}` } : { phase: "open" });
    });
    return () => {
      live = false;
    };
  }, [statusUrl]);
  const [problem, setProblem] = useState<string | null>(null);
  const nameId = useId();
  const ackId = useId();
  const ready = isValidApproverName(approver) && (!acknowledge || ack);

  async function approve() {
    setBusy(true);
    setProblem(null);
    const { url, body } = request(approver, ack);
    const r = await postJson(url, body);
    setBusy(false);
    if (r.ok) {
      setStatus({ phase: "done", text: doneLabel });
      onDone?.(r.data);
    } else if (r.status === 409 && r.code === "already_approved") {
      setStatus({ phase: "done", text: `Already approved by ${r.approvedBy ?? "a person"}` });
    } else {
      setProblem(r.problems?.length ? r.problems.join("; ") : r.error);
    }
  }

  if (status.phase === "done") {
    return (
      <p className="inline-flex items-center gap-1.5 text-[13px] text-fg-2" data-testid={`${testId}-done`} role="status">
        <CircleCheck className="size-4 text-blue-400" strokeWidth={1.75} aria-hidden />
        {status.text}
      </p>
    );
  }
  const checking = status.phase === "checking";

  return (
    <div className="w-full space-y-2">
      {acknowledge ? (
        <div className="flex gap-2 rounded-lg border border-pink-700 bg-pink-900/40 px-3 py-2">
          <input
            id={ackId}
            type="checkbox"
            checked={ack}
            onChange={(e) => setAck(e.target.checked)}
            className="mt-0.5 size-4 shrink-0 accent-pink-500"
            data-testid={`${testId}-ack`}
          />
          <label htmlFor={ackId} className="text-[13px] text-fg-1">
            {acknowledge}
          </label>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={nameId} className="sr-only">
          Your name (recorded on the approval)
        </label>
        <input
          id={nameId}
          value={approver}
          onChange={(e) => setApprover(e.target.value)}
          placeholder="Your name"
          maxLength={80}
          autoComplete="name"
          data-testid={`${testId}-name`}
          className="h-8 w-40 min-w-0 rounded-full border border-line-hover bg-ink-2 px-3 text-[13px] text-fg-1 outline-none placeholder:text-fg-3 focus-visible:border-blue-400"
        />
        <button
          type="button"
          data-testid={testId}
          disabled={busy || checking || !ready}
          onClick={approve}
          className={cn(
            PRIMARY,
            "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] outline-none transition-[background-color,transform] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400 active:scale-[0.98]",
          )}
        >
          <Check className="size-3.5" strokeWidth={2} aria-hidden />
          {busy ? "Approving…" : checking ? "Checking…" : label}
        </button>
      </div>
      {problem ? (
        <p role="alert" className="text-[13px] text-pink-300" data-testid={`${testId}-problem`}>
          {problem}
        </p>
      ) : null}
    </div>
  );
}
