"use client";

import Link from "next/link";
import { useState } from "react";
import { BadgeCheck, Hourglass, Send } from "lucide-react";
import { ActionButton } from "@/components/b/ActionButton";
import { ApiProblem } from "@/components/b/ApiProblem";
import { CopyButton } from "@/components/b/CopyButton";
import { postJson, type ApiFailure } from "@/components/b/api";
import { useRun } from "@/components/b/useRun";

/** Filing status for one report. The filing agent (another lane) updates the report row; this panel mirrors it honestly. */
export function FilingPanel({
  reportId,
  state,
  status,
  confirmation,
  submittedAt,
  initialRunId,
}: {
  reportId: string;
  state: string;
  status: string;
  confirmation: string | null;
  submittedAt: string | null;
  initialRunId: string | null;
}) {
  const { runId, run, running, start: setRunId } = useRun(initialRunId);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ApiFailure | null>(null);

  async function start() {
    setBusy(true);
    setFailure(null);
    const r = await postJson<{ runId: string }>("/api/agents/file", { reportId, state });
    setBusy(false);
    if (!r.ok) return setFailure(r);
    setRunId(r.data.runId);
  }

  const last = run?.trace?.length ? run.trace[run.trace.length - 1] : undefined;

  if (status === "confirmed" || (confirmation && status === "submitted")) {
    return (
      <section aria-labelledby="filing-h" className="rounded-xl border border-blue-800 bg-blue-900/60 p-4" data-testid="filing-confirmed">
        <h3 id="filing-h" className="flex items-center gap-2 text-[15px] font-semibold">
          <BadgeCheck className="size-4 text-blue-500" aria-hidden /> Filed on the replica {state} portal
        </h3>
        {confirmation ? (
          <p className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            Confirmation number <span className="font-mono text-base font-semibold" data-testid="confirmation-number">{confirmation}</span>
            <CopyButton value={confirmation} />
          </p>
        ) : null}
        <p className="mt-1 text-xs text-muted-foreground">{submittedAt ? `Submitted ${submittedAt.slice(0, 10)}. ` : ""}Replica system only: nothing was filed with a real state.</p>
      </section>
    );
  }

  const approved = status === "approved";
  const paused = status === "awaiting_approval";
  // A run attached on page load is "unknown" until its first poll; do not claim it is idle before then.
  const idle = !running && (run !== null || !initialRunId);
  const canStart = ["validated", "awaiting_approval", "approved"].includes(status) && idle;
  return (
    <section aria-labelledby="filing-h" className="rounded-xl border border-border bg-sunken p-4" data-testid="filing-panel">
      <h3 id="filing-h" className="flex items-center gap-2 text-[15px] font-semibold">
        {approved || paused ? <Hourglass className="size-4 text-pink-400" aria-hidden /> : <Send className="size-4 text-muted-foreground" aria-hidden />}
        Filing status
      </h3>
      {status === "validated" && idle ? (
        <p className="mt-1.5 max-w-[62ch] text-sm text-muted-foreground" data-testid="filing-ready">
          Not filed. The filing agent fills the replica {state} holder-reporting form and then stops at the portal&apos;s final &quot;Approve submission&quot; step. It cannot submit until you approve in this app.
        </p>
      ) : null}
      {paused && idle ? (
        <p className="mt-1.5 max-w-[62ch] text-sm" data-testid="filing-waiting">
          The filing agent is paused at &quot;Approve submission&quot; (or was interrupted there). Nothing has been submitted. Approve the submission below to let a running agent continue, or start it again.
        </p>
      ) : null}
      {approved && idle ? (
        <p className="mt-1.5 max-w-[62ch] text-sm" data-testid="filing-waiting">
          Your approval is recorded for this exact file. Start the filing agent to fill the replica {state} form; it will submit without waiting again.
        </p>
      ) : null}
      {canStart ? (
        <div className="mt-3">
          <ActionButton variant="primary" pending={busy} onClick={start} data-testid="run-filing-btn">
            Run filing agent
          </ActionButton>
        </div>
      ) : null}
      {status === "submitted" && !confirmation ? <p className="mt-1.5 text-sm">Submitted to the replica portal. Waiting for the confirmation number.</p> : null}
      {status === "failed" ? <p className="mt-1.5 text-sm text-pink-400">The last filing attempt failed. Check the run, then try again.</p> : null}
      {running || run ? (
        <div className="mt-3 rounded-lg border border-border bg-surface p-3 text-sm" aria-live="polite">
          <p className="flex items-center gap-2 font-medium">
            <span className={running ? "size-1.5 animate-pulse rounded-full bg-blue-500 motion-reduce:animate-none" : "size-1.5 rounded-full bg-fg-3"} aria-hidden />
            {running ? (run?.phase === "awaiting_approval" ? "Paused at 'Approve submission'. Nothing submitted yet" : run?.phase === "approved" ? "Approved. Submitting to the portal" : "Filing agent running") : `Run ${run?.status}`}
          </p>
          {last?.message ? <p className="mt-1 text-muted-foreground">{last.message}</p> : null}
          {run?.error ? <p className="mt-1 text-pink-400">{run.error}</p> : null}
          {runId ? (
            <Link href={`/runs/${runId}`} className="mt-2 inline-block text-xs underline underline-offset-2 hover:text-foreground">
              Open the run trace
            </Link>
          ) : null}
        </div>
      ) : null}
      {failure ? <ApiProblem failure={failure} className="mt-3" /> : null}
    </section>
  );
}
