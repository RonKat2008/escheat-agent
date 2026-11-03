"use client";

import Link from "next/link";
import { ApprovalTitle } from "./ApprovalTitle";
import { OverdueNote } from "./OverdueNote";
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
import { approveBlockReason } from "./approve-block";
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

/** pass: nothing to do. note: worth knowing, does not block. block: approval is refused until it is fixed. */
type CheckLevel = "pass" | "note" | "block";
interface SafetyCheck {
  id: string;
  level: CheckLevel;
  body: React.ReactNode;
}

const CHECK_ICON = { pass: CheckCircle2, note: Info, block: CircleAlert } as const;
const CHECK_TONE = { pass: "text-blue-500", note: "text-fg-3", block: "text-pink-400" } as const;

function CheckRow({ c }: { c: SafetyCheck }) {
  const Icon = CHECK_ICON[c.level];
  return (
    <li className="flex items-start gap-2.5" data-check={c.level}>
      <Icon className={cn("mt-0.5 size-4 shrink-0", CHECK_TONE[c.level])} strokeWidth={1.75} aria-hidden />
      <span className={cn("text-[13px]", c.level === "block" ? "text-fg-1" : "text-fg-2")}>{c.body}</span>
    </li>
  );
}

/** Safety checks split by outcome: what needs attention first (blocking before notes), then what passed. */
function SafetyChecks({ checks }: { checks: SafetyCheck[] }) {
  const attention = [...checks.filter((c) => c.level === "block"), ...checks.filter((c) => c.level === "note")];
  const passed = checks.filter((c) => c.level === "pass");
  const blocking = checks.some((c) => c.level === "block");
  return (
    <div className="grid gap-x-8 gap-y-5 md:grid-cols-2" data-testid="safety-checks">
      {attention.length > 0 ? (
        <div className="min-w-0">
          <h4 className="mb-2.5 flex items-center gap-2 text-xs text-fg-3">
            <span aria-hidden className={cn("size-1.5 rounded-full", blocking ? "bg-pink-500" : "bg-fg-3")} />
            {blocking ? "Needs attention" : "Worth knowing"} <span className="num text-fg-2">{attention.length}</span>
          </h4>
          <ul className="space-y-2.5">
            {attention.map((c) => (
              <CheckRow key={c.id} c={c} />
            ))}
          </ul>
        </div>
      ) : null}
      {passed.length > 0 ? (
        <div className={cn("min-w-0", attention.length === 0 && "md:col-span-2")}>
          <h4 className="mb-2.5 flex items-center gap-2 text-xs text-fg-3">
            <span aria-hidden className="size-1.5 rounded-full bg-blue-500" />
            Passed <span className="num text-fg-2">{passed.length}</span>
          </h4>
          <ul className="space-y-2.5">
            {passed.map((c) => (
              <CheckRow key={c.id} c={c} />
            ))}
          </ul>
        </div>
      ) : null}
    </div>
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
  /** Set when this reviewer approved in this view, so the state change lands with a moment instead of a silent swap. */
  const [justApproved, setJustApproved] = useState(false);

  const needsRecipient = o.channel !== "letter";
  const normalized = to.trim().toLowerCase();
  const allowlisted = !needsRecipient || allow.map((a) => a.toLowerCase()).includes(normalized) || (o.channel === "voice" && allow.some((a) => a.replace(/\D/g, "") === to.replace(/\D/g, "") && to.replace(/\D/g, "").length >= 8));
  const isDone = ["sent", "delivered", "responded", "cancelled"].includes(o.status);
  const isApproved = o.status === "approved";
  const canApprove = !isDone && !isApproved && o.composed && o.readiness.ready && allowlisted && approver.trim().length > 0 && (!needsRecipient || to.trim().length > 0);
  const canSend = isApproved && !isDone;
  // Only a composed draft has been through the language check; an uncomposed one must never read as verified.
  const languageChecked = o.composed && o.requiredLanguageVerified !== null;
  const sentOffline = o.status === "sent" && o.offline;
  const approveBlock = isDone || isApproved ? null : approveBlockReason({ composed: o.composed, problems: o.readiness.problems, needsRecipient, to, allowlisted, approver });
  const Meta = KIND_META[o.channel];

  const refresh = () => startTransition(() => router.refresh());

  async function approve() {
    setBusy("approve");
    setFailure(null);
    const r = await postJson(`/api/outreach/${o.id}/approve`, { approvedBy: approver.trim(), expectedContentSha256: o.contentSha256, ...(needsRecipient ? { to: to.trim() } : {}) });
    setBusy(null);
    if (!r.ok) return setFailure(r);
    setJustApproved(true);
    toast.success("Approval recorded", {
      description: `Tied to this exact content. Nothing has been sent yet: ${o.channel === "voice" ? "place the call" : "send it"} when you are ready.`,
    });
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

  const recipientCheck: SafetyCheck =
    to.trim().length === 0
      ? {
          id: "recipient",
          level: "note",
          body:
            allow.length === 0
              ? `No allowlisted test ${o.channel === "email" ? "recipients" : "numbers"} configured. Set ${o.channel === "email" ? "ALLOWED_TEST_RECIPIENTS" : "ALLOWED_TEST_PHONES"}.`
              : "Choose a recipient from the allowlist.",
        }
      : allowlisted
        ? { id: "recipient", level: "pass", body: "Recipient is on the test allowlist." }
        : { id: "recipient", level: "block", body: "Recipient is not on the test allowlist. The server will refuse to send." };
  const languageCheck: SafetyCheck = !languageChecked
    ? { id: "language", level: "note", body: "Not checked yet. Compose the letter to check the required state notice language." }
    : o.requiredLanguageVerified === true
      ? { id: "language", level: o.readiness.problems.length ? "note" : "pass", body: "Required state notice language is verified." }
      : {
          id: "language",
          level: "note",
          body: (
            <>
              Required state notice language is not verified yet <UnverifiedBadge className="ml-1 align-middle" />
            </>
          ),
        };
  const checks: SafetyCheck[] = [
    { id: "synthetic", level: "pass", body: "Synthetic data only. No real people or accounts." },
    o.channel === "letter"
      ? {
          id: "lob",
          level: env.lobConfigured ? "pass" : "note",
          body: env.lobConfigured ? "Lob TEST mode. No physical mail is produced." : "Lob test key not configured. Approving works; sending will show a preview only once LOB_TEST_API_KEY is set.",
        }
      : recipientCheck,
    ...(o.channel === "letter" ? [languageCheck] : []),
    ...o.readiness.problems.map((p): SafetyCheck => ({ id: `p:${p}`, level: "block", body: p })),
    ...o.readiness.warnings.map((w): SafetyCheck => ({ id: `w:${w}`, level: "note", body: w })),
    ...(o.dependsOnUnverified
      ? [{ id: "unverified", level: "note" as const, body: `Dates for this item depend on unverified rule values (rule ${o.ruleVersion ?? "unknown"}).` }]
      : []),
  ];

  const what =
    o.channel === "letter"
      ? `A certified due-diligence letter will be mailed to ${o.ownerAddress || "the owner's address on file"} through Lob in TEST mode. No real mail is produced.`
      : o.channel === "email"
        ? `One email will be sent to the recipient below. It links to the owner response page.`
        : `A simulated check-in call will be placed to the recipient below using the script shown.`;

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 px-6 pt-6 pb-5">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[13px] text-fg-3">
            <Meta.icon className="size-3.5" strokeWidth={1.5} aria-hidden />
            {Meta.label}
          </p>
          <h2 tabIndex={-1} data-detail-heading className="mt-1 text-xl leading-7 font-semibold tracking-[-0.015em] break-words text-fg-1 outline-none focus-visible:underline focus-visible:decoration-blue-400 focus-visible:underline-offset-4">
            <ApprovalTitle title={entry.title} />
          </h2>
          <p className="mt-1 text-[13px] text-fg-2">
            {entry.subtitle}
            <Link
              href={`/items?item=${o.staleItemId}`}
              className="ml-3 inline-flex items-center gap-1 text-blue-400 underline-offset-2 hover:text-blue-300 hover:underline"
            >
              Open item <ExternalLink className="size-3" strokeWidth={1.5} aria-hidden />
            </Link>
          </p>
          <OverdueNote overdue={entry.overdue} className="mt-2" />
        </div>
        <div className="flex items-center gap-3 sm:flex-col sm:items-end sm:gap-1.5">
          {entry.amountCents != null ? <Money cents={entry.amountCents} className="text-2xl font-medium tracking-[-0.02em] text-fg-1" /> : null}
          <span key={o.status} className={cn("inline-flex", justApproved && isApproved && "es-stamp")}>
            <StatusPill status={sentOffline ? "sent_offline" : o.status} />
          </span>
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
            /* Deliberately white: this is the exact document the owner receives, so it is shown as paper on a dark desk. */
            <figure className="overflow-hidden rounded-xl border border-line bg-ink-2" data-testid="letter-preview">
              <figcaption className="flex items-center justify-between gap-3 border-b border-line px-3.5 py-2 text-xs text-fg-3">
                <span className="flex min-w-0 items-center gap-1.5">
                  <Meta.icon className="size-3.5 shrink-0" strokeWidth={1.5} aria-hidden />
                  <span className="truncate">{o.channel === "letter" ? "Print preview, US Letter, as mailed" : "Rendered exactly as delivered"}</span>
                </span>
                <a
                  href={`/api/outreach/${o.id}/preview`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex shrink-0 items-center gap-1 rounded-sm text-fg-2 underline-offset-2 transition-colors duration-150 hover:text-fg-1 hover:underline"
                >
                  Open full size <ExternalLink className="size-3" strokeWidth={1.5} aria-hidden />
                </a>
              </figcaption>
              <div className="es-desk px-3 pt-5 pb-7 sm:px-10 sm:pt-8 sm:pb-10">
                <div className="relative mx-auto w-full max-w-[680px]">
                  {/* The sheet underneath: one offset edge is enough to read as paper, not a screenshot. */}
                  <span aria-hidden className="absolute inset-x-2 top-2 -bottom-2 rounded-[3px] bg-[#e9ebf0] shadow-[0_0_0_1px_rgb(255_255_255/0.06)]" />
                  <iframe
                    title={`${CHANNEL_LABEL[o.channel]} preview`}
                    src={`/api/outreach/${o.id}/preview`}
                    sandbox=""
                    loading="lazy"
                    className="relative block h-[min(560px,64vh)] w-full rounded-[3px] bg-white shadow-[0_0_0_1px_rgb(255_255_255/0.12),0_1px_0_rgb(255_255_255/0.5)_inset,0_24px_48px_-20px_rgb(0_0_0/0.95),0_2px_6px_rgb(0_0_0/0.5)]"
                  />
                </div>
                <p className="mx-auto mt-4 flex max-w-[680px] items-center justify-between gap-3 text-[11px] text-fg-3">
                  <span>{o.channel === "letter" ? "US Letter, 8.5 × 11 in" : o.channel === "email" ? "HTML email" : "Call script"}</span>
                  <span className="font-mono">sha256 {o.contentSha256.slice(0, 12)}</span>
                </p>
              </div>
            </figure>
          ) : (
            <div className="es-desk relative flex min-h-48 flex-col items-start justify-center gap-3 overflow-hidden rounded-xl border border-line p-5 sm:flex-row sm:items-center sm:gap-6">
              {/* A blank sheet: what will appear here once composed. Decorative, no fake text. */}
              <span aria-hidden className="hidden h-36 w-28 shrink-0 rounded-[3px] bg-[#e9ebf0]/[0.06] shadow-[0_0_0_1px_rgb(255_255_255/0.08)] sm:block">
                <span className="mx-3 mt-4 block h-1.5 w-12 rounded-full bg-white/10" />
                <span className="mx-3 mt-3 block h-1 w-20 rounded-full bg-white/[0.07]" />
                <span className="mx-3 mt-1.5 block h-1 w-16 rounded-full bg-white/[0.07]" />
                <span className="mx-3 mt-1.5 block h-1 w-[4.5rem] rounded-full bg-white/[0.07]" />
              </span>
              <div className="flex flex-col items-start gap-3">
              <p className="max-w-[52ch] text-[13px] text-fg-2">
                The agent queued this {CHANNEL_LABEL[o.channel].toLowerCase()} but has not composed it yet. Compose it to see exactly what the owner will receive, then approve.
              </p>
              <ActionButton variant="primary" pending={busy === "draft"} onClick={() => draft(o.channel)} data-testid="compose-btn">
                Compose {CHANNEL_LABEL[o.channel].toLowerCase()}
              </ActionButton>
              </div>
            </div>
          )}
        </section>

        <section aria-labelledby="checks">
          <h3 id="checks" className="mb-3 text-[13px] font-medium text-fg-1">
            Safety checks
          </h3>
          <SafetyChecks checks={checks} />
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
            {o.status === "cancelled"
              ? "This draft was cancelled."
              : `${sentOffline ? "Sent (offline — nothing mailed)" : "Sent"}${o.sentOn ? ` on ${o.sentOn}` : ""}${o.approvedBy ? ` · approved by ${o.approvedBy}` : ""}.`}
          </p>
        ) : (
          <>
            {!isApproved ? <ApproverField value={approver} onChange={setApprover} className="w-full sm:w-52" /> : null}
            <div className="min-w-[14rem] flex-1 text-xs leading-5 text-fg-3">
              {isApproved ? (
                <span className={cn("block", justApproved && "es-detail-in")}>
                  Approved by <span className="text-fg-1">{o.approvedBy ?? "reviewer"}</span>. Editing this draft after approval voids the approval.
                </span>
              ) : (
                "Your approval is tied to exactly this content. If the draft changes afterwards, it must be approved again."
              )}
            </div>
            {approveBlock ? (
              <p id="approve-blocked" data-testid="approve-blocked" className="w-full text-xs leading-5 text-pink-300">
                Can&apos;t approve yet: {approveBlock}
              </p>
            ) : null}
            <div className="flex w-full items-center justify-end gap-2 sm:w-auto">
              <ActionButton
                id="approve-btn"
                variant={isApproved ? "quiet" : "approve"}
                pending={busy === "approve"}
                disabled={!canApprove}
                onClick={approve}
                data-testid="approve-btn"
                title={approveBlock ?? undefined}
                aria-describedby={approveBlock ? "approve-blocked" : undefined}
              >
                {isApproved ? (
                  <>
                    <CheckCircle2 className={cn("size-4 text-blue-400", justApproved && "es-stamp")} strokeWidth={2} aria-hidden />
                    Approved
                  </>
                ) : (
                  "Approve"
                )}
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
