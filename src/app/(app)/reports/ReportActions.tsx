"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ActionButton } from "@/components/b/ActionButton";
import { ApiProblem } from "@/components/b/ApiProblem";
import { ApproverField, useApprover } from "@/components/b/ApproverField";
import { postJson, type ApiFailure } from "@/components/b/api";

export function GenerateButton({ state, hasReport, disabled }: { state: string; hasReport: boolean; disabled: boolean }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  async function run() {
    setBusy(true);
    setFailure(null);
    const r = await postJson<{ status: string; errors: { severity: string }[] }>("/api/reports", { state });
    setBusy(false);
    if (!r.ok) return setFailure(r);
    const errs = r.data.errors.filter((e) => e.severity === "error").length;
    if (errs) toast.error(`${state} report generated with ${errs} validation error${errs > 1 ? "s" : ""}.`);
    else toast.success(`${state} report generated and validated.`);
    startTransition(() => router.refresh());
  }
  return (
    <div className="flex flex-col items-end gap-2">
      <ActionButton variant={hasReport ? "quiet" : "primary"} pending={busy} disabled={disabled} onClick={run} data-testid="generate-btn">
        {hasReport ? "Regenerate report" : "Generate report"}
      </ActionButton>
      {failure ? <ApiProblem failure={failure} className="max-w-md" /> : null}
    </div>
  );
}

export function ApproveReportButton({ reportId, blocked }: { reportId: string; blocked: boolean }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [approver, setApprover] = useApprover();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  async function run() {
    setBusy(true);
    setFailure(null);
    const r = await postJson(`/api/reports/${reportId}/approve`, { approvedBy: approver.trim() });
    setBusy(false);
    if (!r.ok) return setFailure(r);
    toast.success("Submission approved. The filing agent will submit now.");
    startTransition(() => router.refresh());
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <ApproverField value={approver} onChange={setApprover} className="w-full sm:w-56" />
        <ActionButton variant="approve" pending={busy} disabled={blocked || !approver.trim()} onClick={run} data-testid="approve-report-btn">
          Approve submission
        </ActionButton>
      </div>
      {blocked ? <p className="text-sm text-danger">Fix the validation errors above and regenerate before approving.</p> : null}
      {failure ? <ApiProblem failure={failure} /> : null}
    </div>
  );
}
