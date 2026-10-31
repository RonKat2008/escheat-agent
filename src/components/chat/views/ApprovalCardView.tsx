"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Check, CircleCheck, Clock, FileText, Mail, Phone } from "lucide-react";
import { postJson } from "@/components/b/api";
import { useApprover } from "@/components/b/ApproverField";
import type { ApprovalCardUi } from "@/lib/chat/ui-types";
import { cn } from "@/lib/utils";
import { AttentionNote, FooterLink, UnverifiedFlag } from "./parts";

const CHANNEL = {
  letter: { noun: "Due-diligence letter", verb: "mailed", icon: FileText },
  email: { noun: "Due-diligence email", verb: "emailed", icon: Mail },
  voice: { noun: "Check-in call script", verb: "called", icon: Phone },
} as const;

/**
 * Shows exactly what would go out and who must approve it. The Approve button is a HUMAN action: it calls the
 * existing approval endpoint with the reviewer's name and the hash of the content shown here. Nothing the
 * model does can press it. Approving records consent only; sending stays a separate step in Approvals.
 */
export function ApprovalCardView(p: ApprovalCardUi["props"]) {
  const c = CHANNEL[p.channel];
  const [approver, setApprover] = useApprover();
  const [status, setStatus] = useState(p.status);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const nameId = useId();
  const approved = status === "approved";
  const editable = status === "draft" || status === "awaiting_approval";
  // Email/voice need a recipient from the allowlist; that choice lives in Approvals. A letter is approvable here only
  // when the card shows everything the approval hash covers (full body, every address field): people approve what they see.
  const inlineApprove = p.channel === "letter" && editable && p.readiness.ready && p.fullyShown;
  const recipient = p.channel === "letter" && p.toAddressLines.length ? p.toAddressLines : null;
  const Icon = c.icon;

  async function approve() {
    setBusy(true);
    setProblem(null);
    const r = await postJson<{ status: string }>(`/api/outreach/${p.outreachId}/approve`, {
      approvedBy: approver.trim(),
      expectedContentSha256: p.contentSha256,
    });
    setBusy(false);
    if (r.ok) {
      setStatus("approved");
      toast.success(`Approved by ${approver.trim()}. Nothing has been sent; send it from Approvals.`);
    } else {
      setProblem(r.problems?.length ? r.problems.join("; ") : r.error);
    }
  }

  return (
    <section data-testid="view-approval-card" className="overflow-hidden rounded-[10px] border border-[var(--chat-line-strong)] bg-[var(--chat-ink-1)]">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-[var(--chat-line)] px-4 py-3">
        <Icon className="size-4 shrink-0 text-[var(--chat-t3)]" strokeWidth={1.5} aria-hidden />
        <div className="min-w-0 flex-1">
          <h3 className="text-[13px] font-medium text-[var(--chat-t1)]">
            {c.noun} for {recipient?.[0] ?? p.ownerName}
            {p.checkNumber ? `, #${p.checkNumber}` : ""}
          </h3>
          <p className="text-xs text-[var(--chat-t3)] tabular-nums">{p.amountFormatted}</p>
        </div>
        <span
          data-testid="approval-state"
          className={cn(
            "inline-flex h-5 items-center gap-1 text-xs font-medium",
            approved ? "text-[var(--chat-t2)]" : "rounded-full bg-[var(--chat-pink)] px-2 text-black",
          )}
        >
          {approved ? <CircleCheck className="size-3.5 text-[var(--chat-blue-500)]" strokeWidth={1.5} aria-hidden /> : <Clock className="size-3" strokeWidth={2} aria-hidden />}
          {approved ? "Approved by a person" : "Needs your approval"}
        </span>
      </header>

      <div className="space-y-3 px-4 py-4">
        <p className="text-[13px] text-[var(--chat-t2)]">
          <span className="font-medium text-[var(--chat-t1)]">Nothing has been {c.verb} or sent.</span> This is a draft. It goes out only after a person approves it and then sends it from Approvals.
        </p>
        <dl className="grid gap-x-4 gap-y-1.5 text-[13px] sm:grid-cols-[5.5rem_minmax(0,1fr)]">
          <dt className="text-[var(--chat-t3)]">To</dt>
          <dd className="text-[var(--chat-t1)]" data-testid="approval-recipient">
            {recipient ? (
              recipient.map((line, i) => (
                <span key={`${i}-${line}`} className={cn("block", i > 0 && "text-[var(--chat-t2)]")}>
                  {line}
                </span>
              ))
            ) : (
              <>
                {p.ownerName}
                <span className="block text-[var(--chat-t3)]">
                  {p.channel === "letter" ? "No mailing address on the draft yet" : "Recipient is picked from the test allowlist in Approvals"}
                </span>
              </>
            )}
          </dd>
          {p.subject ? (
            <>
              <dt className="text-[var(--chat-t3)]">Subject</dt>
              <dd className="text-[var(--chat-t1)]">{p.subject}</dd>
            </>
          ) : null}
          {p.requiredLanguageVerified === false ? (
            <>
              <dt className="text-[var(--chat-t3)]">Rule text</dt>
              <dd>
                <UnverifiedFlag />
                <span className="ml-2 text-xs text-[var(--chat-t3)]">statutory wording not yet verified</span>
              </dd>
            </>
          ) : null}
        </dl>
        {p.bodyText ? (
          <div className="relative">
            <pre
              tabIndex={0}
              aria-label="Draft content"
              className="max-h-64 overflow-y-auto rounded-lg border border-[var(--chat-line)] bg-black/40 px-4 py-3 font-sans text-[13px] leading-relaxed whitespace-pre-wrap text-[var(--chat-t2)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--chat-blue-text)]"
            >
              {p.bodyText}
              {p.bodyTruncated ? <span className="mt-3 block text-[var(--chat-t3)]">[The draft continues. Open it in Approvals to read the rest.]</span> : null}
            </pre>
          </div>
        ) : (
          <p className="text-[13px] text-[var(--chat-t3)]">Not composed yet. Open it in Approvals to compose and review.</p>
        )}
        {editable && !p.fullyShown ? (
          <AttentionNote>
            {p.bodyTruncated ? "This draft is longer than the card can show. " : "Part of this draft cannot be shown here. "}
            Review the full content in Approvals before approving it.
          </AttentionNote>
        ) : null}
        {p.readiness.problems.map((m) => (
          <AttentionNote key={m}>{m}</AttentionNote>
        ))}
        {p.readiness.warnings.map((m) => (
          <AttentionNote key={m}>{m}</AttentionNote>
        ))}
        {problem ? <AttentionNote>{problem}</AttentionNote> : null}
      </div>

      <footer className="flex flex-wrap items-center gap-2 border-t border-[var(--chat-line)] px-4 py-3">
        {inlineApprove && !approved ? (
          <>
            <label htmlFor={nameId} className="sr-only">
              Your name (recorded on the approval)
            </label>
            <input
              id={nameId}
              value={approver}
              onChange={(e) => setApprover(e.target.value)}
              placeholder="Your name"
              maxLength={80}
              className="h-8 w-40 rounded-md border border-[var(--chat-line-strong)] bg-transparent px-2.5 text-[13px] text-[var(--chat-t1)] outline-none placeholder:text-[var(--chat-t3)] focus-visible:border-[var(--chat-blue-text)]"
            />
            <button
              type="button"
              data-testid="chat-approve-btn"
              disabled={busy || !approver.trim()}
              onClick={approve}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[var(--chat-blue)] px-3 text-[13px] font-medium text-white outline-none transition-[background-color,transform] duration-150 hover:bg-[var(--chat-blue-700)] focus-visible:ring-2 focus-visible:ring-[var(--chat-blue-text)] focus-visible:ring-offset-2 focus-visible:ring-offset-black active:scale-[0.98] disabled:opacity-40"
            >
              <Check className="size-3.5" aria-hidden />
              {busy ? "Approving…" : "Approve as me"}
            </button>
          </>
        ) : null}
        <Link
          href={p.reviewUrl}
          data-testid="approval-review-link"
          className={cn(
            "inline-flex h-8 items-center rounded-md px-3 text-[13px] outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-[var(--chat-blue-text)]",
            inlineApprove && !approved ? "text-[var(--chat-t2)] hover:bg-[var(--chat-ink-3)] hover:text-[var(--chat-t1)]" : "border border-[var(--chat-line-strong)] text-[var(--chat-t1)] hover:border-[var(--chat-blue-500)]/60 hover:bg-[var(--chat-blue-900)]",
          )}
        >
          {approved ? "Send from Approvals" : "Review in Approvals"}
        </Link>
        <span className="flex-1" />
        <FooterLink href={p.previewUrl} external>
          Preview
        </FooterLink>
      </footer>
    </section>
  );
}
