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
      <section aria-labelledby="filing-h" className="rounded-xl border border-resolved/40 bg-resolved/10 p-4" data-testid="filing-confirmed">
        <h3 id="filing-h" className="flex items-center gap-2 text-[15px] font-semibold">
          <BadgeCheck className="size-4 text-resolved" aria-hidden /> Filed on the replica {state} portal
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
  return (
    <section aria-labelledby="filing-h" className="rounded-xl border border-border bg-sunken p-4" data-testid="filing-panel">
      <h3 id="filing-h" className="flex items-center gap-2 text-[15px] font-semibold">
        {approved ? <Hourglass className="size-4 text-at-risk" aria-hidden /> : <Send className="size-4 text-muted-foreground" aria-hidden />}
        Filing status
      </h3>
      {!approved && status !== "submitted" && status !== "failed" ? (
        <p className="mt-1.5 text-sm text-muted-foreground">Not filed. Approve the report first; the filing agent never starts without your approval.</p>
      ) : null}
      {approved && !running ? (
        <>
          <p className="mt-1.5 max-w-[62ch] text-sm" data-testid="filing-waiting">
            Filing agent waiting for your go-ahead. Your approval is recorded. Start it to fill the replica {state} holder-reporting form; it pauses at the portal&apos;s final submit.
          </p>
          <div className="mt-3">
            <ActionButton variant="primary" pending={busy} onClick={start} data-testid="run-filing-btn">
              Run filing agent
            </ActionButton>
          </div>
        </>
      ) : null}
      {status === "submitted" && !confirmation ? <p className="mt-1.5 text-sm">Submitted to the replica portal. Waiting for the confirmation number.</p> : null}
      {status === "failed" ? <p className="mt-1.5 text-sm text-danger">The last filing attempt failed. Check the run, then try again.</p> : null}
      {running || run ? (
        <div className="mt-3 rounded-lg border border-border bg-surface p-3 text-sm" aria-live="polite">
          <p className="flex items-center gap-2 font-medium">
            <span className={running ? "size-1.5 animate-pulse rounded-full bg-at-risk motion-reduce:animate-none" : "size-1.5 rounded-full bg-muted-foreground"} aria-hidden />
            {running ? (run?.phase === "awaiting_approval" ? "Paused at the portal's submit button" : "Filing agent running") : `Run ${run?.status}`}
          </p>
          {last?.message ? <p className="mt-1 text-muted-foreground">{last.message}</p> : null}
          {run?.error ? <p className="mt-1 text-danger">{run.error}</p> : null}
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
