"use client";

import { useId, useState, type ReactNode } from "react";
import { Check, CircleCheck } from "lucide-react";
import { postJson } from "@/components/b/api";
import { useApprover } from "@/components/b/ApproverField";
import { PRIMARY } from "@/components/ui/button";
import { isValidApproverName } from "@/lib/auth/approver";
import type { ApprovalRequest } from "@/lib/ask/cards/approval-request";
import { cn } from "@/lib/utils";

/**
 * The human half of every Ask approval card: a typed name, an optional "approve anyway" acknowledgement, and a coral
 * button. The click POSTs `request(name, acknowledged)` (built by src/lib/ask/cards/approval-request.ts, the same
 * endpoint and body as the matching page) and nothing else: no POST on mount or in an effect. The server re-checks the
 * session, the name and the hash; a refusal (409 on changed content, missing acknowledgement) is shown verbatim and the
 * row stays unapproved.
 */
export function ApproveControl({
  label,
  request,
  acknowledge,
  doneLabel = "Approved by a person",
  testId = "card-approve",
  onDone,
}: {
  label: string;
  request: (approvedBy: string, acknowledged: boolean) => ApprovalRequest;
  /** "Approve anyway" text; the box must be ticked before the button enables. */
  acknowledge?: ReactNode;
  doneLabel?: string;
  testId?: string;
  onDone?: (data: Record<string, unknown>) => void;
}) {
  const [approver, setApprover] = useApprover();
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
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
      setDone(true);
      onDone?.(r.data);
    } else {
      setProblem(r.problems?.length ? r.problems.join("; ") : r.error);
    }
  }

  if (done) {
    return (
      <p className="inline-flex items-center gap-1.5 text-[13px] text-fg-2" data-testid={`${testId}-done`} role="status">
        <CircleCheck className="size-4 text-blue-400" strokeWidth={1.75} aria-hidden />
        {doneLabel}
      </p>
    );
  }

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
          disabled={busy || !ready}
          onClick={approve}
          className={cn(
            PRIMARY,
            "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] outline-none transition-[background-color,transform] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400 active:scale-[0.98]",
          )}
        >
          <Check className="size-3.5" strokeWidth={2} aria-hidden />
          {busy ? "Approving…" : label}
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
