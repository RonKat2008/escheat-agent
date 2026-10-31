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
import { buttonVariants } from "@/components/ui/button";
import { KIND_META } from "./kinds";
import type { QueueEntry } from "./queue-data";

function Frame({ entry, children, footer }: { entry: QueueEntry; children: React.ReactNode; footer?: React.ReactNode }) {
  const Meta = KIND_META[entry.kind];
  return (
    <div className="animate-in fade-in slide-in-from-right-2 duration-200 motion-reduce:animate-none">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 px-6 pt-6 pb-5">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[13px] text-fg-3">
            <Meta.icon className="size-3.5" strokeWidth={1.5} aria-hidden />
            {Meta.label}
          </p>
          <h2 className="mt-1 text-xl leading-7 font-semibold tracking-[-0.015em] break-words text-fg-1">{entry.title}</h2>
          <p className="mt-1 text-[13px] text-fg-2">{entry.subtitle}</p>
        </div>
        <div className="flex items-center gap-3 sm:flex-col sm:items-end sm:gap-1.5">
          {entry.amountCents != null ? <Money cents={entry.amountCents} className="text-2xl font-medium tracking-[-0.02em] text-fg-1" /> : null}
          <StatusPill status={entry.statusKey} />
        </div>
      </div>
      <div className="space-y-6 px-6 pb-6">{children}</div>
      {footer ? (
        <div className="sticky bottom-0 flex flex-wrap items-end gap-x-4 gap-y-3 border-t border-line bg-ink-0/90 px-6 py-4 backdrop-blur-md">{footer}</div>
      ) : null}
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-fg-3">{label}</dt>
      <dd className="num mt-1 text-base font-medium text-fg-1">{children}</dd>
    </div>
  );
}

function useApprove(url: string, done: string, expected: Record<string, string>) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [approver, setApprover] = useApprover();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  async function approve() {
    setBusy(true);
    setFailure(null);
    const r = await postJson(url, { approvedBy: approver.trim(), ...expected });
    setBusy(false);
    if (!r.ok) return setFailure(r);
    toast.success(done);
    startTransition(() => router.refresh());
  }
  return { approver, setApprover, busy, failure, approve };
}

export function ReportDetail({ entry }: { entry: QueueEntry }) {
  const r = entry.report!;
  const a = useApprove(`/api/reports/${r.id}/approve`, `${r.state} report approved for filing.`, { expectedChecksum: r.checksum ?? "" });
  const approved = r.status === "approved";
  const blocked = r.errorCount > 0;
  return (
    <Frame
      entry={entry}
      footer={
        approved ? (
          <p className="text-[13px] text-fg-2">Approved. Run the filing agent from Reports.</p>
        ) : (
          <>
            <ApproverField value={a.approver} onChange={a.setApprover} className="w-full sm:w-52" />
            <p className="min-w-0 flex-1 text-xs leading-5 text-fg-3">Approval is tied to this file&apos;s checksum. Regenerating the report voids it.</p>
            <ActionButton id="approve-btn" variant="approve" pending={a.busy} disabled={blocked || !a.approver.trim()} onClick={a.approve} data-testid="approve-btn">
              Approve for filing
            </ActionButton>
          </>
        )
      }
    >
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 border-y border-line py-4 sm:grid-cols-4">
        <Fact label="Items">{r.itemCount}</Fact>
        <Fact label="Total">
          <Money cents={r.totalCents} />
        </Fact>
        <Fact label="Errors">
          <span className={r.errorCount ? "text-pink-400" : ""}>{r.errorCount}</span>
        </Fact>
        <Fact label="Warnings">{r.warningCount}</Fact>
      </dl>
      <div>
        <p className="mb-1 text-xs text-fg-3">File checksum (sha256)</p>
        <p className="font-mono text-xs break-all text-fg-2">{r.checksum}</p>
      </div>
      {blocked ? <ApiProblem failure={{ ok: false, status: 422, code: "not_ready", error: "This report has validation errors. Fix them in Reports and regenerate before approving." }} /> : null}
      {a.failure ? <ApiProblem failure={a.failure} /> : null}
      <Link href={`/reports?state=${r.state}`} className="inline-flex items-center gap-1 text-[13px] text-blue-400 underline-offset-2 hover:text-blue-300 hover:underline">
        Review the file and validation in Reports <ArrowUpRight className="size-3.5" strokeWidth={1.5} aria-hidden />
      </Link>
    </Frame>
  );
}

export function ClaimDetail({ entry }: { entry: QueueEntry }) {
  const c = entry.claim!;
  const a = useApprove(`/api/recoveries/${c.id}/approve`, "Claim approved.", { expectedPayloadSha256: c.payloadSha256 });
  const approved = entry.statusKey === "approved";
  return (
    <Frame
      entry={entry}
      footer={
        approved ? (
          <p className="text-[13px] text-fg-2">Approved. File the claim from Recoveries.</p>
        ) : (
          <>
            <ApproverField value={a.approver} onChange={a.setApprover} className="w-full sm:w-52" />
            <p className="min-w-0 flex-1 text-xs leading-5 text-fg-3">Filing only ever happens on the replica portal. Approval is tied to the claim as drafted.</p>
            <ActionButton id="approve-btn" variant="approve" pending={a.busy} disabled={!a.approver.trim()} onClick={a.approve} data-testid="approve-btn">
              Approve claim
            </ActionButton>
          </>
        )
      }
    >
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 border-y border-line py-4 sm:grid-cols-4">
        <Fact label="State">{c.state}</Fact>
        <Fact label="Amount">
          <Money cents={c.amountCents} />
        </Fact>
        <Fact label="Matched name">{c.matchedNameVariant ?? "Unknown"}</Fact>
        <Fact label="Confidence">{c.matchConfidence != null ? `${c.matchConfidence}%` : "Unknown"}</Fact>
      </dl>
      {a.failure ? <ApiProblem failure={a.failure} /> : null}
      <Link href="/recoveries" className="inline-flex items-center gap-1 text-[13px] text-blue-400 underline-offset-2 hover:text-blue-300 hover:underline">
        See the match in Recoveries <ArrowUpRight className="size-3.5" strokeWidth={1.5} aria-hidden />
      </Link>
    </Frame>
  );
}

export function RuleDetail({ entry }: { entry: QueueEntry }) {
  const r = entry.rule!;
  return (
    <Frame entry={entry}>
      <p className="max-w-[60ch] text-[13px] leading-6 text-fg-2">
        The research agent proposed moving {r.state} from <span className="font-mono">{r.fromVersion ?? "none"}</span> to <span className="font-mono">{r.toVersion ?? "a new version"}</span> with{" "}
        {r.sourceCount} cited sources. Rule changes are reviewed side by side with their sources on the Rules page, because the law is never decided by a model.
      </p>
      <Link href="/rules" className={buttonVariants({ variant: "outline" })}>
        Review in Rules <ArrowUpRight className="size-3.5" strokeWidth={1.5} aria-hidden />
      </Link>
    </Frame>
  );
}
