"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CheckCircle2, CircleAlert, ExternalLink, FileText, Info, Plus } from "lucide-react";
import { toast } from "sonner";
import { ActionButton } from "@/components/b/ActionButton";
import { ApiProblem } from "@/components/b/ApiProblem";
import { ApproverField, useApprover } from "@/components/b/ApproverField";
import { postJson, type ApiFailure } from "@/components/b/api";
import { Money, StatusPill, UnverifiedBadge } from "@/components/primitives";
import { cn } from "@/lib/utils";
import { KIND_META } from "./kinds";
import type { QueueData, QueueEntry } from "./queue-data";

const CHANNELS = ["letter", "email", "voice"] as const;
const CHANNEL_LABEL = { letter: "Letter", email: "Email", voice: "Call" } as const;
const CHANNEL_NEW = { letter: "Draft letter", email: "Draft email", voice: "Draft call script" } as const;

interface SendOutcome {
  sent: boolean;
  offline: boolean;
  providerId: string | null;
  previewUrl: string | null;
  status: string;
}

function Check({ ok, children, warn }: { ok: boolean; warn?: boolean; children: React.ReactNode }) {
  const Icon = ok ? CheckCircle2 : warn ? Info : CircleAlert;
  return (
    <li className="flex items-start gap-2.5">
      <Icon className={cn("mt-0.5 size-4 shrink-0", ok ? "text-blue-500" : warn ? "text-fg-3" : "text-pink-400")} strokeWidth={1.75} aria-hidden />
      <span className={cn("text-[13px]", ok ? "text-fg-2" : warn ? "text-fg-2" : "text-fg-1")}>{children}</span>
    </li>
  );
}

export function OutreachDetail({
  entry,
  env,
  onSelectKey,
}: {
  entry: QueueEntry;
  env: QueueData["env"];
  onSelectKey: (key: string) => void;
}) {
  const o = entry.outreach!;
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [approver, setApprover] = useApprover();
  const allow = o.channel === "email" ? env.allowedEmails : o.channel === "voice" ? env.allowedPhones : [];
  const [to, setTo] = useState(o.toAddress ?? allow[0] ?? "");
  const [busy, setBusy] = useState<"approve" | "send" | "draft" | null>(null);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [outcome, setOutcome] = useState<SendOutcome | null>(null);

  const needsRecipient = o.channel !== "letter";
  const normalized = to.trim().toLowerCase();
  const allowlisted = !needsRecipient || allow.map((a) => a.toLowerCase()).includes(normalized) || (o.channel === "voice" && allow.some((a) => a.replace(/\D/g, "") === to.replace(/\D/g, "") && to.replace(/\D/g, "").length >= 8));
  const isDone = ["sent", "delivered", "responded", "cancelled"].includes(o.status);
  const isApproved = o.status === "approved";
  const canApprove = !isDone && !isApproved && o.composed && o.readiness.ready && allowlisted && approver.trim().length > 0 && (!needsRecipient || to.trim().length > 0);
  const canSend = isApproved && !isDone;
  const Meta = KIND_META[o.channel];

  const refresh = () => startTransition(() => router.refresh());

  async function approve() {
    setBusy("approve");
    setFailure(null);
    const r = await postJson(`/api/outreach/${o.id}/approve`, { approvedBy: approver.trim(), expectedContentSha256: o.contentSha256, ...(needsRecipient ? { to: to.trim() } : {}) });
    setBusy(null);
    if (!r.ok) return setFailure(r);
    toast.success("Approved. You can send it now.");
    refresh();
  }

  async function send() {
    setBusy("send");
    setFailure(null);
    const r = await postJson<SendOutcome>(`/api/outreach/${o.id}/send`, needsRecipient ? { to: to.trim() } : {});
    setBusy(null);
    if (!r.ok) return setFailure(r);
    setOutcome(r.data);
    toast.success(r.data.offline ? "Offline: nothing was sent." : r.data.sent ? "Sent in test mode." : "Done.");
    refresh();
  }

  async function draft(channel: (typeof CHANNELS)[number]) {
    setBusy("draft");
    setFailure(null);
    const r = await postJson<{ outreachId: string }>("/api/outreach/draft", { staleItemId: o.staleItemId, channel });
    setBusy(null);
    if (!r.ok) return setFailure(r);
    toast.success(`${CHANNEL_LABEL[channel]} draft created.`);
    refresh();
    onSelectKey(`o:${r.data.outreachId}`);
  }

  const what =
    o.channel === "letter"
      ? `A certified due-diligence letter will be mailed to ${o.ownerAddress || "the owner's address on file"} through Lob in TEST mode. No real mail is produced.`
      : o.channel === "email"
        ? `One email will be sent to the recipient below. It links to the owner response page.`
        : `A simulated check-in call will be placed to the recipient below using the script shown.`;

  return (
    <div className="animate-in fade-in slide-in-from-right-2 duration-200 motion-reduce:animate-none">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 px-6 pt-6 pb-5">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[13px] text-fg-3">
            <Meta.icon className="size-3.5" strokeWidth={1.5} aria-hidden />
            {Meta.label}
          </p>
          <h2 className="mt-1 text-xl leading-7 font-semibold tracking-[-0.015em] break-words text-fg-1">{entry.title}</h2>
          <p className="mt-1 text-[13px] text-fg-2">
            {entry.subtitle}
            <Link
              href={`/items?item=${o.staleItemId}`}
              className="ml-3 inline-flex items-center gap-1 text-blue-400 underline-offset-2 hover:text-blue-300 hover:underline"
            >
              Open item <ExternalLink className="size-3" strokeWidth={1.5} aria-hidden />
            </Link>
          </p>
        </div>
        <div className="flex items-center gap-3 sm:flex-col sm:items-end sm:gap-1.5">
          {entry.amountCents != null ? <Money cents={entry.amountCents} className="text-2xl font-medium tracking-[-0.02em] text-fg-1" /> : null}
          <StatusPill status={o.status} />
        </div>
      </div>

      <div className="space-y-7 px-6 pb-6">
        <div role="group" aria-label="Channel for this item" className="flex flex-wrap items-center gap-1.5">
          {CHANNELS.map((c) => {
            const sib = o.siblings[c];
            const active = c === o.channel;
            if (sib) {
              return (
                <button
                  key={c}
                  type="button"
                  aria-pressed={active}
                  onClick={() => !active && onSelectKey(`o:${sib.id}`)}
                  className={cn(
                    "h-8 rounded-md border px-3 text-[13px] transition-colors duration-150 max-sm:h-10",
                    active ? "border-line-strong bg-ink-3 text-fg-1" : "border-line text-fg-2 hover:bg-ink-2 hover:text-fg-1",
                  )}
                >
                  {CHANNEL_LABEL[c]}
                </button>
              );
            }
            return (
              <button
                key={c}
                type="button"
                disabled={busy !== null}
                onClick={() => draft(c)}
                className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[13px] text-fg-3 transition-colors duration-150 hover:bg-ink-2 hover:text-fg-1 disabled:opacity-45 max-sm:h-10"
              >
                <Plus className="size-3.5" strokeWidth={1.5} aria-hidden />
                {CHANNEL_NEW[c]}
              </button>
            );
          })}
        </div>

        <section aria-labelledby="what-happens">
          <h3 id="what-happens" className="mb-1.5 text-[13px] font-medium text-fg-1">
            What will happen
          </h3>
          <p className="max-w-[68ch] text-[13px] leading-6 text-pretty text-fg-2">{what}</p>
        </section>

        <section aria-labelledby="what-sent">
          <h3 id="what-sent" className="mb-2.5 flex items-center gap-2 text-[13px] font-medium text-fg-1">
            Exactly what will be sent
          </h3>
          {o.channel === "email" && o.subject ? (
            <p className="mb-2.5 text-[13px] text-fg-1">
              <span className="text-fg-3">Subject </span>
              {o.subject}
            </p>
          ) : null}
          {o.composed ? (
            <div className="rounded-xl border border-line bg-ink-2 p-2 sm:p-3">
              <iframe
                title={`${CHANNEL_LABEL[o.channel]} preview`}
                src={`/api/outreach/${o.id}/preview`}
                sandbox=""
                loading="lazy"
                className="block h-[min(480px,62vh)] w-full rounded-md bg-white shadow-[0_1px_0_rgb(255_255_255/0.06),0_12px_32px_-12px_rgb(0_0_0/0.8)]"
              />
            </div>
          ) : (
            <div className="flex min-h-40 flex-col items-start justify-center gap-3 rounded-xl border border-line bg-ink-2 p-5">
              <p className="max-w-[52ch] text-[13px] text-fg-2">
                The agent queued this {CHANNEL_LABEL[o.channel].toLowerCase()} but has not composed it yet. Compose it to see exactly what the owner will receive, then approve.
              </p>
              <ActionButton variant="primary" pending={busy === "draft"} onClick={() => draft(o.channel)} data-testid="compose-btn">
                Compose {CHANNEL_LABEL[o.channel].toLowerCase()}
              </ActionButton>
            </div>
          )}
        </section>

        <section aria-labelledby="checks">
          <h3 id="checks" className="mb-3 text-[13px] font-medium text-fg-1">
            Safety checks
          </h3>
          <ul className="grid gap-x-6 gap-y-2.5 md:grid-cols-2">
            <Check ok>Synthetic data only. No real people or accounts.</Check>
            {o.channel === "letter" ? (
              <Check ok={env.lobConfigured} warn={!env.lobConfigured}>
                {env.lobConfigured ? "Lob TEST mode. No physical mail is produced." : "Lob test key not configured. Approving works; sending will show a preview only once LOB_TEST_API_KEY is set."}
              </Check>
            ) : (
              <Check ok={allowlisted && to.trim().length > 0} warn={to.trim().length === 0}>
                {to.trim().length === 0
                  ? allow.length === 0
                    ? `No allowlisted test ${o.channel === "email" ? "recipients" : "numbers"} configured. Set ${o.channel === "email" ? "ALLOWED_TEST_RECIPIENTS" : "ALLOWED_TEST_PHONES"}.`
                    : "Choose a recipient from the allowlist."
                  : allowlisted
                    ? "Recipient is on the test allowlist."
                    : "Recipient is not on the test allowlist. The server will refuse to send."}
              </Check>
            )}
            {o.channel === "letter" ? (
              <Check ok={o.requiredLanguageVerified !== false && !o.readiness.problems.length} warn={o.requiredLanguageVerified === false && !o.readiness.problems.length}>
                {o.requiredLanguageVerified === false ? (
                  <>
                    Required state notice language is not verified yet <UnverifiedBadge className="ml-1 align-middle" />
                  </>
                ) : (
                  "Required state notice language is verified."
                )}
              </Check>
            ) : null}
            {o.readiness.problems.map((p) => (
              <Check key={p} ok={false}>
                {p}
              </Check>
            ))}
            {o.readiness.warnings.map((w) => (
              <Check key={w} ok={false} warn>
                {w}
              </Check>
            ))}
            {o.dependsOnUnverified ? (
              <Check ok={false} warn>
                Dates for this item depend on unverified rule values (rule {o.ruleVersion ?? "unknown"}).
              </Check>
            ) : null}
          </ul>
          {o.composed && !o.readiness.ready && !isDone && !isApproved ? (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <ActionButton variant="quiet" pending={busy === "draft"} onClick={() => draft(o.channel)} data-testid="recompose-btn">
                Recompose draft
              </ActionButton>
              <span className="text-xs text-fg-3">Fixed the problem above? Recompose to re-check this draft.</span>
            </div>
          ) : null}
          {needsRecipient && !isDone ? (
            <div className="mt-3 max-w-sm space-y-1">
              <label htmlFor={`to-${o.id}`} className="text-xs text-fg-3">
                Recipient ({o.channel === "email" ? "email" : "phone"})
              </label>
              <input
                id={`to-${o.id}`}
                list={`allow-${o.id}`}
                value={to}
                disabled={isApproved}
                onChange={(e) => setTo(e.target.value)}
                className="h-8 w-full rounded-md border border-line-hover bg-ink-2 px-2.5 font-mono text-[13px] text-fg-1 transition-[border-color] duration-150 outline-none hover:border-line-strong focus-visible:border-blue-400 focus-visible:outline-none disabled:opacity-60"
              />
              <datalist id={`allow-${o.id}`}>
                {allow.map((a) => (
                  <option key={a} value={a} />
                ))}
              </datalist>
            </div>
          ) : null}
        </section>

        {failure ? <ApiProblem failure={failure} /> : null}

        {outcome ? (
          <div role="status" data-testid="send-outcome" className="rounded-lg border border-blue-800 bg-blue-900/60 p-3.5 text-[13px]">
            <p className="flex items-center gap-2 font-medium text-fg-1">
              <CheckCircle2 className="size-4 text-blue-400" strokeWidth={1.75} aria-hidden />
              {outcome.offline ? "Offline mode: nothing was sent." : o.channel === "letter" ? "Letter accepted by Lob (test mode)." : o.channel === "email" ? "Email sent." : "Call placed."}
            </p>
            <p className="mt-1 text-blue-300">
              {outcome.providerId ? (
                <>
                  {o.channel === "letter" ? "Lob letter" : o.channel === "email" ? "Email id" : "Call id"}: <span className="font-mono text-fg-1">{outcome.providerId}</span>
                </>
              ) : (
                "No provider id was returned."
              )}
            </p>
            {outcome.previewUrl ? (
              <a href={outcome.previewUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1.5 text-fg-1 underline underline-offset-2">
                <FileText className="size-3.5" aria-hidden /> Open Lob preview PDF
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="sticky bottom-0 flex flex-wrap items-end gap-x-4 gap-y-3 border-t border-line bg-ink-0/90 px-6 py-4 backdrop-blur-md">
        {isDone ? (
          <p className="text-[13px] text-fg-2">
            {o.status === "cancelled" ? "This draft was cancelled." : `Sent${o.sentAt ? ` ${o.sentAt.slice(0, 10)}` : ""}${o.approvedBy ? ` · approved by ${o.approvedBy}` : ""}.`}
          </p>
        ) : (
          <>
            {!isApproved ? <ApproverField value={approver} onChange={setApprover} className="w-full sm:w-52" /> : null}
            <div className="min-w-[14rem] flex-1 text-xs leading-5 text-fg-3">
              {isApproved ? (
                <>
                  Approved by <span className="text-fg-1">{o.approvedBy ?? "reviewer"}</span>. Editing this draft after approval voids the approval.
                </>
              ) : (
                "Your approval is tied to exactly this content. If the draft changes afterwards, it must be approved again."
              )}
            </div>
            <div className="flex w-full items-center justify-end gap-2 sm:w-auto">
              <ActionButton id="approve-btn" variant={isApproved ? "quiet" : "approve"} pending={busy === "approve"} disabled={!canApprove} onClick={approve} data-testid="approve-btn">
                {isApproved ? "Approved" : "Approve"}
              </ActionButton>
              <ActionButton variant={canSend ? "primary" : "quiet"} pending={busy === "send"} disabled={!canSend} onClick={send} data-testid="send-btn" title={canSend ? undefined : "Approve first. Nothing sends without approval."}>
                {o.channel === "voice" ? "Place call" : "Send"}
              </ActionButton>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
