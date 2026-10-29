"use client";

import Link from "next/link";
import { useState } from "react";
import { ActionButton } from "@/components/b/ActionButton";
import { ApiProblem } from "@/components/b/ApiProblem";
import { postJson, type ApiFailure } from "@/components/b/api";
import { useRun } from "@/components/b/useRun";

export function RunRecoveryButton({ hasResults }: { hasResults: boolean }) {
  const { runId, run, running, start } = useRun(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  async function go() {
    setBusy(true);
    setFailure(null);
    const r = await postJson<{ runId: string }>("/api/agents/recover", {});
    setBusy(false);
    if (!r.ok) return setFailure(r);
    start(r.data.runId);
  }
  const last = run?.trace?.length ? run.trace[run.trace.length - 1] : undefined;
  return (
    <div className="flex max-w-sm flex-col items-start gap-2 sm:items-end" aria-live="polite">
      <ActionButton variant={hasResults ? "quiet" : "primary"} pending={busy || running} onClick={go} data-testid="run-recovery-btn">
        {running ? "Searching replica portals" : hasResults ? "Search again" : "Run recovery search"}
      </ActionButton>
      {run ? (
        <p className="text-xs text-muted-foreground sm:text-right">
          {running ? (last?.message ?? "Starting") : run.status === "succeeded" ? "Search finished." : `Search ${run.status}${run.error ? `: ${run.error}` : ""}`}{" "}
          {runId ? (
            <Link href={`/runs/${runId}`} className="underline underline-offset-2 hover:text-foreground">
              Trace
            </Link>
          ) : null}
        </p>
      ) : null}
      {failure ? <ApiProblem failure={failure} /> : null}
    </div>
  );
}
