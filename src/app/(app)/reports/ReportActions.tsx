"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { refreshAfterRunAction } from "@/app/(app)/runs/actions";
import { ActionButton } from "@/components/b/ActionButton";
import { ApiProblem } from "@/components/b/ApiProblem";
import { ApproverField, useApprover } from "@/components/b/ApproverField";
import { postJson, type ApiFailure } from "@/components/b/api";

export function GenerateButton({
  state,
  mode,
  disabled,
  autoStart = false,
}: {
  state: string;
  mode: "generate" | "regenerate" | "next";
  disabled: boolean;
  /** Catch-up deep link: generate once on mount (the same POST as a click). Generating files nothing. */
  autoStart?: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const started = useRef(false);
  useEffect(() => {
    if (!autoStart || disabled || started.current) return;
    started.current = true;
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once per mount; `run` is recreated every render
  }, [autoStart, disabled]);
  async function run() {
    setBusy(true);
    setFailure(null);
    const r = await postJson<{ status: string; errors: { severity: string }[] }>("/api/reports", { state });
    setBusy(false);
    if (!r.ok) return setFailure(r);
    const errs = r.data.errors.filter((e) => e.severity === "error").length;
    if (errs) toast.error(`${state} report generated with ${errs} validation error${errs > 1 ? "s" : ""}.`);
    else toast.success(`${state} report generated and validated.`);
    await refreshAfterRunAction().catch(() => undefined);
    startTransition(() => router.refresh());
  }
  return (
    <div className="flex flex-col items-end gap-2">
      <ActionButton variant={mode === "generate" ? "primary" : "quiet"} pending={busy} disabled={disabled} onClick={run} data-testid="generate-btn">
        {mode === "regenerate" ? "Regenerate report" : mode === "next" ? "Start next report" : "Generate report"}
      </ActionButton>
      {failure ? <ApiProblem failure={failure} className="max-w-md" /> : null}
    </div>
  );
}

export function ApproveReportButton({ reportId, checksum, blocked }: { reportId: string; checksum: string; blocked: boolean }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [approver, setApprover] = useApprover();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  async function run() {
    setBusy(true);
    setFailure(null);
    const r = await postJson(`/api/reports/${reportId}/approve`, { approvedBy: approver.trim(), expectedChecksum: checksum });
    setBusy(false);
    if (!r.ok) return setFailure(r);
    toast.success("Submission approved. The filing agent will submit now.");
    await refreshAfterRunAction().catch(() => undefined);
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
      {blocked ? <p className="text-sm text-pink-400">Fix the validation errors above and regenerate before approving.</p> : null}
      {failure ? <ApiProblem failure={failure} /> : null}
    </div>
  );
}
