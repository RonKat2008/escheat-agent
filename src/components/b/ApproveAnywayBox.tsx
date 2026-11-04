"use client";

import { TriangleAlert } from "lucide-react";
import { useId } from "react";

/** The "approve anyway" acknowledgement for a report approval (same wording as the runner; the server re-derives the counts). */
export function ApproveAnywayBox({
  unverified,
  unsent,
  checked,
  onChange,
}: {
  unverified: number;
  unsent: number;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  const id = useId();
  if (unverified === 0 && unsent === 0) return null;
  return (
    <div className="flex gap-2.5 rounded-lg border border-pink-700 bg-pink-900/40 px-3 py-2.5" data-testid="report-ack">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-pink-500" data-testid="report-ack-box" />
      <label htmlFor={id} className="text-[13px] text-fg-1">
        <TriangleAlert className="mr-1 inline size-3.5 -translate-y-px text-pink-300" aria-hidden />
        Approve anyway:
        {unverified > 0 ? (
          <>
            {" "}
            this file relies on <span className="font-semibold">{unverified}</span> UNVERIFIED rule {unverified === 1 ? "value" : "values"} nobody has checked against the statute yet
          </>
        ) : null}
        {unverified > 0 && unsent > 0 ? ", and" : null}
        {unsent > 0 ? (
          <>
            {" "}
            <span className="font-semibold">{unsent}</span> required due-diligence {unsent === 1 ? "notice was" : "notices were"} never sent
          </>
        ) : null}
        . The count you acknowledge is frozen on the filing record.
      </label>
    </div>
  );
}
