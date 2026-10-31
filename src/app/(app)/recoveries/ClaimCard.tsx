"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check } from "lucide-react";
import { toast } from "sonner";
import { ActionButton } from "@/components/b/ActionButton";
import { ApiProblem } from "@/components/b/ApiProblem";
import { ApproverField, useApprover } from "@/components/b/ApproverField";
import { postJson, type ApiFailure } from "@/components/b/api";
import { nameDiff } from "@/components/b/name-diff";
import { useRun } from "@/components/b/useRun";
import { Money, StatusPill } from "@/components/primitives";
import type { RecoveryView } from "@/lib/recoveries/service";
import { cn } from "@/lib/utils";

const STEPS = ["Found", "Claim drafted", "Approved", "Submitted", "Paid"] as const;

function stepIndex(r: RecoveryView): number {
  if (r.status === "paid") return 4;
  if (r.status === "claim_submitted") return 3;
  if (r.approvalId) return 2;
  if (r.status === "claim_drafted" || r.status === "awaiting_approval") return 1;
  return 0;
}

function Timeline({ at, rejected }: { at: number; rejected: boolean }) {
  return (
    <ol className="flex flex-wrap items-center gap-x-1 gap-y-2" aria-label="Claim progress">
      {STEPS.map((s, i) => {
        const done = i < at;
        const current = i === at && !rejected;
        return (
          <li key={s} className="flex items-center gap-1" aria-current={current ? "step" : undefined}>
            <span
              className={cn(
                "grid size-[18px] place-items-center rounded-full border text-[10px]",
                done ? "border-blue-600 bg-blue-600 text-white" : current ? "border-pink-500 ring-2 ring-pink-500/25" : "border-strong",
              )}
            >
              {done ? <Check className="size-3" aria-hidden /> : null}
            </span>
            <span className={cn("mr-2 text-xs", done || current ? "text-foreground" : "text-muted-foreground")}>{s}</span>
            {i < STEPS.length - 1 ? <span aria-hidden className={cn("mr-1 hidden h-px w-4 sm:block", done ? "bg-blue-500" : "bg-border")} /> : null}
          </li>
        );
      })}
    </ol>
  );
}

export function ClaimCard({ recovery: r, companyName }: { recovery: RecoveryView; companyName: string }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [approver, setApprover] = useApprover();
  const [busy, setBusy] = useState<"approve" | "file" | null>(null);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const { runId, run, running, start } = useRun(null);
  const at = stepIndex(r);
  const approved = Boolean(r.approvalId);
  const submitted = r.status === "claim_submitted" || r.status === "paid";
  const parts = r.matchedNameVariant ? nameDiff(companyName, r.matchedNameVariant) : [];
  const differs = parts.some((p) => p.differs);

  async function approve() {
    setBusy("approve");
    setFailure(null);
    const res = await postJson(`/api/recoveries/${r.id}/approve`, { approvedBy: approver.trim(), expectedPayloadSha256: r.payloadSha256 });
    setBusy(null);
    if (!res.ok) return setFailure(res);
    toast.success("Claim approved.");
    startTransition(() => router.refresh());
  }
  async function file() {
    setBusy("file");
    setFailure(null);
    const res = await postJson<{ runId: string }>(`/api/agents/claim/${r.id}`, {});
    setBusy(null);
    if (!res.ok) return setFailure(res);
    start(res.data.runId);
  }

  return (
    <article className="rounded-[14px] border border-border bg-surface" data-testid="recovery-card" aria-label={`${r.state} recovery`}>
      <div className="grid gap-5 p-5 md:grid-cols-[auto_minmax(0,1fr)_auto] md:items-start md:gap-7">
        <div className="flex items-center gap-4 md:block">
          <span className="rounded-md border border-strong px-2 py-1 text-sm font-semibold tracking-wide">{r.state}</span>
          <Money cents={r.amountCents} className="text-[2rem] leading-none font-semibold text-blue-400 md:mt-3 md:block" />
        </div>
        <div className="min-w-0 space-y-3">
          <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-fg-3">Your company</dt>
              <dd className="mt-1 text-sm break-words">{companyName}</dd>
            </div>
            <div>
              <dt className="text-xs text-fg-3">Matched as</dt>
              <dd className="mt-1 text-sm break-words" data-testid="matched-variant">
                {parts.length ? (
                  parts.map((p, i) => (
                    <span key={i} className={p.differs ? "rounded-sm bg-pink-900/40 px-px text-pink-300 underline decoration-pink-500/60 underline-offset-2" : undefined}>
                      {p.text}
                    </span>
                  ))
                ) : (
                  <span className="text-muted-foreground italic">Unknown</span>
                )}
                {differs ? <span className="sr-only"> (highlighted characters differ from your company name)</span> : null}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-fg-3">Confidence</dt>
              <dd className="mt-1 flex items-center gap-2.5 text-sm">
                {r.matchConfidence != null ? (
                  <>
                    <span className="h-1.5 w-24 overflow-hidden rounded-full bg-raised" aria-hidden>
                      <span className="block h-full origin-left rounded-full bg-fg-3" style={{ width: `${r.matchConfidence}%` }} />
                    </span>
                    <span className="font-mono tabular-nums">{r.matchConfidence}%</span>
                  </>
                ) : (
                  <span className="text-muted-foreground italic">Unknown</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-fg-3">Source</dt>
              <dd className="mt-1 text-sm text-muted-foreground">Replica {r.state} unclaimed property search</dd>
            </div>
          </dl>
          <Timeline at={at} rejected={r.status === "rejected"} />
        </div>
        <div className="flex items-start md:justify-end">
          <StatusPill status={approved && r.status === "awaiting_approval" ? "approved" : r.status} />
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-x-4 gap-y-3 border-t border-border px-5 py-4">
        {r.claimConfirmation ? (
          <p className="text-sm">
            Claim confirmation <span className="font-mono font-semibold text-blue-400">{r.claimConfirmation}</span>
          </p>
        ) : submitted || r.status === "rejected" ? (
          <p className="text-sm text-muted-foreground">{r.status === "rejected" ? "The state rejected this claim." : "Claim submitted. Waiting on the state."}</p>
        ) : approved ? (
          <>
            <p className="min-w-0 flex-1 text-sm text-muted-foreground">
              Approved by <span className="text-foreground">{r.approval?.approvedBy ?? "reviewer"}</span>. The agent files it on the replica portal.
            </p>
            <ActionButton variant="primary" pending={busy === "file" || running} onClick={file} data-testid="file-claim-btn">
              File claim
            </ActionButton>
          </>
        ) : (
          <>
            <ApproverField value={approver} onChange={setApprover} className="w-full sm:w-52" />
            <p className="min-w-0 flex-1 text-xs leading-5 text-muted-foreground">Approving records your sign-off on the claim as drafted. Nothing is submitted until you also file it.</p>
            <ActionButton variant="approve" pending={busy === "approve"} disabled={!approver.trim()} onClick={approve} data-testid="approve-claim-btn">
              Approve claim
            </ActionButton>
          </>
        )}
      </div>
      {run || failure ? (
        <div className="space-y-2 px-5 pb-4" aria-live="polite">
          {run ? (
            <p className="text-sm text-muted-foreground">
              {running ? "Filing agent running. " : `Run ${run.status}. `}
              {runId ? (
                <Link href={`/runs/${runId}`} className="underline underline-offset-2 hover:text-foreground">
                  Open trace
                </Link>
              ) : null}
            </p>
          ) : null}
          {failure ? <ApiProblem failure={failure} /> : null}
        </div>
      ) : null}
    </article>
  );
}
