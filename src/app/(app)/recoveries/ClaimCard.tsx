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
        // Pink while a human still has to act (approve or file); blue once the agent or the state is working.
        const human = current && at <= 2;
        return (
          <li key={s} className="flex items-center gap-1.5" aria-current={current ? "step" : undefined}>
            <span
              className={cn(
                "grid size-4 place-items-center rounded-full",
                done ? "bg-blue-600 text-white" : current ? cn("border-2", human ? "border-pink-500" : "border-blue-500") : "border border-fg-4",
              )}
            >
              {done ? <Check className="size-2.5" strokeWidth={3} aria-hidden /> : null}
              {current ? <span className={cn("es-pulse size-1 rounded-full", human ? "bg-pink-500" : "bg-blue-500")} /> : null}
            </span>
            <span className={cn("text-xs", done ? "text-fg-2" : current ? "text-fg-1" : "text-fg-3")}>{s}</span>
            {i < STEPS.length - 1 ? (
              <span aria-hidden className="relative mx-1 hidden h-px w-5 bg-line sm:block">
                {done ? <span className="es-grow-x absolute inset-0 bg-blue-500" style={{ ["--i" as string]: i }} /> : null}
              </span>
            ) : (
              <span className="sr-only" />
            )}
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
    <article className="rounded-xl border border-line bg-ink-2" data-testid="recovery-card" aria-label={`${r.state} recovery`}>
      <div className="space-y-6 p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <p className="text-[13px] text-fg-2">Replica {r.state} unclaimed property search</p>
            <Money cents={r.amountCents} className="mt-2 block text-[2rem] leading-none font-medium tracking-[-0.03em] text-fg-1" />
          </div>
          <StatusPill status={approved && r.status === "awaiting_approval" ? "approved" : r.status} />
        </div>

        <dl className="grid gap-x-10 gap-y-5 sm:grid-cols-2">
          <div className="min-w-0">
            <dt className="text-[13px] text-fg-2">Your company</dt>
            <dd className="mt-1.5 text-[15px] break-words text-fg-1">{companyName}</dd>
          </div>
          <div className="min-w-0 border-line max-sm:border-t max-sm:pt-5 sm:border-l sm:pl-10">
            <dt className="text-[13px] text-fg-2">Matched as</dt>
            <dd className="mt-1.5 text-[15px] break-words text-fg-1" data-testid="matched-variant">
              {parts.length ? (
                parts.map((p, i) => (
                  <span key={i} className={p.differs ? "rounded-sm bg-pink-500/20 px-0.5 text-pink-300 underline decoration-pink-500/70 decoration-1 underline-offset-[3px]" : undefined}>
                    {p.text}
                  </span>
                ))
              ) : (
                <span className="text-fg-3 italic">Unknown</span>
              )}
              {differs ? <span className="sr-only"> (highlighted characters differ from your company name)</span> : null}
            </dd>
            {differs ? <p className="mt-1.5 text-xs text-fg-3">Highlighted text differs from your company name.</p> : null}
          </div>
        </dl>

        <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-4">
          <div className="flex items-center gap-3 text-[13px]">
            <span className="text-fg-2">Match confidence</span>
            {r.matchConfidence != null ? (
              <>
                <span className="h-1 w-32 overflow-hidden rounded-full bg-ink-3" aria-hidden>
                  <span className="es-grow-x block h-full rounded-full bg-blue-500" style={{ width: `${r.matchConfidence}%` }} />
                </span>
                <span className="num text-fg-1">{r.matchConfidence}%</span>
              </>
            ) : (
              <span className="text-fg-3 italic">Unknown</span>
            )}
          </div>
          <Timeline at={at} rejected={r.status === "rejected"} />
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-x-4 gap-y-3 border-t border-line px-5 py-4 sm:px-6">
        {r.claimConfirmation ? (
          <p className="text-sm">
            Claim confirmation <span className="font-mono font-semibold text-blue-400">{r.claimConfirmation}</span>
          </p>
        ) : submitted || r.status === "rejected" ? (
          <p className="text-sm text-fg-2">{r.status === "rejected" ? "The state rejected this claim." : "Claim submitted. Waiting on the state."}</p>
        ) : approved ? (
          <>
            <p className="min-w-0 flex-1 text-sm text-fg-2">
              Approved by <span className="text-fg-1">{r.approval?.approvedBy ?? "reviewer"}</span>. The agent files it on the replica portal.
            </p>
            <ActionButton variant="primary" pending={busy === "file" || running} onClick={file} data-testid="file-claim-btn">
              File claim
            </ActionButton>
          </>
        ) : (
          <>
            <ApproverField value={approver} onChange={setApprover} className="w-full sm:w-52" />
            <p className="min-w-0 flex-1 text-xs leading-5 text-fg-2">Approving records your sign-off on the claim as drafted. Nothing is submitted until you also file it.</p>
            <ActionButton variant="approve" pending={busy === "approve"} disabled={!approver.trim()} onClick={approve} data-testid="approve-claim-btn">
              Approve claim
            </ActionButton>
          </>
        )}
      </div>
      {run || failure ? (
        <div className="space-y-2 px-5 pb-4 sm:px-6" aria-live="polite">
          {run ? (
            <p className="text-sm text-fg-2">
              {running ? "Filing agent running. " : `Run ${run.status}. `}
              {runId ? (
                <Link href={`/runs/${runId}`} className="underline underline-offset-2 hover:text-fg-1">
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
