"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { Landmark } from "lucide-react";
import { ActionButton } from "@/components/b/ActionButton";
import { ApproverField, useApprover } from "@/components/b/ApproverField";
import { postJson } from "@/components/b/api";
import { Money } from "@/components/primitives";
import { isValidApproverName } from "@/lib/auth/approver";
import { formatDate } from "@/lib/format";
import { toast } from "@/lib/toast";

export interface RecordRemittanceProps {
  state: string;
  reportId: string;
  count: number;
  totalCents: number;
  remitDue: string | null;
  /** The company's "today" (demo clock): the default and latest allowed date. */
  today: string;
}

/**
 * R5-05 on Reports: record that the state was paid OUTSIDE this app. The server (POST /api/close-out/remit) requires
 * the typed name, binds the approval to these items, this total, date and reference, and moves the items to Remitted,
 * which stops the late clock. Nothing is paid from here.
 */
export function RecordRemittance({ state, reportId, count, totalCents, remitDue, today }: RecordRemittanceProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [approver, setApprover] = useApprover();
  const [date, setDate] = useState(today);
  const [reference, setReference] = useState("");
  const [error, setError] = useState<{ text: string; href?: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const dateId = useId();
  const refId = useId();
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= today;

  function confirm() {
    setError(null);
    startTransition(async () => {
      const r = await postJson("/api/close-out/remit", {
        state,
        reportId,
        approvedBy: approver,
        remittedOn: date,
        reference: reference.trim() || null,
        expectedCount: count,
        expectedCents: totalCents,
      });
      if (!r.ok) return setError({ text: r.error, href: r.href });
      toast.success(`Remittance recorded. ${count} ${count === 1 ? "item" : "items"} moved to Remitted.`);
      setOpen(false);
      router.refresh();
    });
  }

  const field = "h-8 w-full rounded-md border border-line-hover bg-ink-2 px-2.5 text-[13px] text-fg-1 outline-none hover:border-line-strong focus-visible:border-blue-400";
  return (
    <section aria-labelledby="remit-h" className="rounded-xl border border-pink-500/50 bg-ink-2 p-5" data-testid="record-remittance">
      <h3 id="remit-h" className="flex items-center gap-2 text-sm font-medium text-fg-1">
        <Landmark className="size-4 text-pink-300" strokeWidth={1.75} aria-hidden />
        Remit to {state}
      </h3>
      <p className="mt-1 max-w-[62ch] text-sm text-fg-2">
        The report is filed. <Money cents={totalCents} /> for {count} reported {count === 1 ? "item" : "items"} is still owed
        {remitDue ? `, due ${formatDate(remitDue)}` : ""}. Pay the state outside this app, then record it here: the items move to Remitted and the late clock
        stops. Nothing is paid from this app.
      </p>
      {!open ? (
        <ActionButton variant="quiet" className="mt-3" onClick={() => setOpen(true)} data-testid="record-remittance-open">
          Record remittance
        </ActionButton>
      ) : (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <label htmlFor={dateId} className="text-xs text-fg-3">
                Paid on
              </label>
              <input id={dateId} type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} className={`${field} sm:w-44`} data-testid="record-remittance-date" />
            </div>
            <div className="space-y-1">
              <label htmlFor={refId} className="text-xs text-fg-3">
                Payment reference (optional)
              </label>
              <input
                id={refId}
                value={reference}
                maxLength={80}
                onChange={(e) => setReference(e.target.value)}
                placeholder="e.g. wire or check number"
                className={`${field} placeholder:text-fg-3 sm:w-56`}
                data-testid="record-remittance-ref"
              />
            </div>
            <ApproverField value={approver} onChange={setApprover} className="w-full sm:w-52" />
          </div>
          <div className="flex flex-wrap gap-2">
            <ActionButton variant="approve" pending={pending} disabled={!isValidApproverName(approver) || !validDate} onClick={confirm} data-testid="record-remittance-confirm">
              Confirm remittance
            </ActionButton>
            <ActionButton variant="quiet" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </ActionButton>
          </div>
          {error ? (
            <p role="alert" className="text-sm text-pink-400" data-testid="record-remittance-error">
              {error.text}
              {error.href ? (
                <>
                  {" "}
                  <Link href={error.href} className="text-blue-300 underline underline-offset-2 hover:text-blue-200" data-testid="record-remittance-error-link">
                    See the recorded remittance
                  </Link>
                </>
              ) : null}
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}
