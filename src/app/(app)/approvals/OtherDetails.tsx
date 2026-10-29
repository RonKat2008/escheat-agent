"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowUpRight } from "lucide-react";
import { toast } from "sonner";
import { ActionButton } from "@/components/b/ActionButton";
import { ApiProblem } from "@/components/b/ApiProblem";
import { ApproverField, useApprover } from "@/components/b/ApproverField";
import { postJson, type ApiFailure } from "@/components/b/api";
import { Money, StatusPill } from "@/components/primitives";
import { KIND_META } from "./kinds";
import type { QueueEntry } from "./queue-data";

function Frame({ entry, children, footer }: { entry: QueueEntry; children: React.ReactNode; footer?: React.ReactNode }) {
  const Meta = KIND_META[entry.kind];
  return (
    <div className="animate-in fade-in slide-in-from-right-2 duration-200 motion-reduce:animate-none">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-raised text-muted-foreground">
            <Meta.icon className="size-[18px]" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="text-lg leading-6 font-semibold break-words">{entry.title}</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">{entry.subtitle}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {entry.amountCents != null ? <Money cents={entry.amountCents} className="text-xl font-semibold" /> : null}
          <StatusPill status={entry.statusKey} />
        </div>
      </div>
      <div className="space-y-5 px-5 py-5">{children}</div>
      {footer ? <div className="flex flex-wrap items-end gap-x-4 gap-y-3 rounded-b-[14px] border-t border-border px-5 py-4">{footer}</div> : null}
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-medium tracking-[0.08em] text-muted-foreground uppercase">{label}</dt>
      <dd className="mt-1 text-sm">{children}</dd>
    </div>
  );
}

function useApprove(url: string, done: string) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [approver, setApprover] = useApprover();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  async function approve() {
    setBusy(true);
    setFailure(null);
    const r = await postJson(url, { approvedBy: approver.trim() });
    setBusy(false);
    if (!r.ok) return setFailure(r);
    toast.success(done);
    startTransition(() => router.refresh());
  }
  return { approver, setApprover, busy, failure, approve };
}

export function ReportDetail({ entry }: { entry: QueueEntry }) {
  const r = entry.report!;
  const a = useApprove(`/api/reports/${r.id}/approve`, `${r.state} report approved for filing.`);
  const approved = r.status === "approved";
  const blocked = r.errorCount > 0;
  return (
    <Frame
      entry={entry}
      footer={
        approved ? (
          <p className="text-sm text-muted-foreground">Approved. Run the filing agent from Reports.</p>
        ) : (
          <>
            <ApproverField value={a.approver} onChange={a.setApprover} className="w-full sm:w-52" />
            <p className="min-w-0 flex-1 text-xs leading-5 text-muted-foreground">Approval is tied to this file&apos;s checksum. Regenerating the report voids it.</p>
            <ActionButton id="approve-btn" variant="approve" pending={a.busy} disabled={blocked || !a.approver.trim()} onClick={a.approve} data-testid="approve-btn">
              Approve for filing
            </ActionButton>
          </>
        )
      }
    >
      <dl className="grid grid-cols-2 gap-5 sm:grid-cols-4">
        <Fact label="Items">{r.itemCount}</Fact>
        <Fact label="Total">
          <Money cents={r.totalCents} />
        </Fact>
        <Fact label="Errors">
          <span className={r.errorCount ? "text-danger" : ""}>{r.errorCount}</span>
        </Fact>
        <Fact label="Warnings">{r.warningCount}</Fact>
      </dl>
      <div>
        <p className="mb-1 text-[11px] font-medium tracking-[0.08em] text-muted-foreground uppercase">File checksum (sha256)</p>
        <p className="font-mono text-xs break-all text-muted-foreground">{r.checksum}</p>
      </div>
      {blocked ? <ApiProblem failure={{ ok: false, status: 422, code: "not_ready", error: "This report has validation errors. Fix them in Reports and regenerate before approving." }} /> : null}
      {a.failure ? <ApiProblem failure={a.failure} /> : null}
      <Link href={`/reports?state=${r.state}`} className="inline-flex items-center gap-1 text-sm underline underline-offset-2 hover:text-foreground">
        Review the file and validation in Reports <ArrowUpRight className="size-3.5" aria-hidden />
      </Link>
    </Frame>
  );
}

export function ClaimDetail({ entry }: { entry: QueueEntry }) {
  const c = entry.claim!;
  const a = useApprove(`/api/recoveries/${c.id}/approve`, "Claim approved.");
  const approved = entry.statusKey === "approved";
  return (
    <Frame
      entry={entry}
      footer={
        approved ? (
          <p className="text-sm text-muted-foreground">Approved. File the claim from Recoveries.</p>
        ) : (
          <>
            <ApproverField value={a.approver} onChange={a.setApprover} className="w-full sm:w-52" />
            <p className="min-w-0 flex-1 text-xs leading-5 text-muted-foreground">Filing only ever happens on the replica portal. Approval is tied to the claim as drafted.</p>
            <ActionButton id="approve-btn" variant="approve" pending={a.busy} disabled={!a.approver.trim()} onClick={a.approve} data-testid="approve-btn">
              Approve claim
            </ActionButton>
          </>
        )
      }
    >
      <dl className="grid grid-cols-2 gap-5 sm:grid-cols-4">
        <Fact label="State">{c.state}</Fact>
        <Fact label="Amount">
          <Money cents={c.amountCents} className="text-resolved" />
        </Fact>
        <Fact label="Matched name">{c.matchedNameVariant ?? "Unknown"}</Fact>
        <Fact label="Confidence">{c.matchConfidence != null ? `${c.matchConfidence}%` : "Unknown"}</Fact>
      </dl>
      {a.failure ? <ApiProblem failure={a.failure} /> : null}
      <Link href="/recoveries" className="inline-flex items-center gap-1 text-sm underline underline-offset-2 hover:text-foreground">
        See the match in Recoveries <ArrowUpRight className="size-3.5" aria-hidden />
      </Link>
    </Frame>
  );
}

export function RuleDetail({ entry }: { entry: QueueEntry }) {
  const r = entry.rule!;
  return (
    <Frame entry={entry}>
      <p className="max-w-[60ch] text-sm leading-6">
        The research agent proposed moving {r.state} from <span className="font-mono">{r.fromVersion ?? "none"}</span> to <span className="font-mono">{r.toVersion ?? "a new version"}</span> with{" "}
        {r.sourceCount} cited sources. Rule changes are reviewed side by side with their sources on the Rules page, because the law is never decided by a model.
      </p>
      <Link href="/rules" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-strong px-3.5 text-sm font-medium hover:bg-raised focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
        Review in Rules <ArrowUpRight className="size-4" aria-hidden />
      </Link>
    </Frame>
  );
}
