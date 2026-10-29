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
    <li className="flex items-start gap-2.5 text-sm">
      <Icon className={cn("mt-0.5 size-4 shrink-0", ok ? "text-resolved" : warn ? "text-muted-foreground" : "text-danger")} aria-hidden />
      <span className={cn(!ok && !warn && "text-foreground")}>{children}</span>
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
    const r = await postJson(`/api/outreach/${o.id}/approve`, { approvedBy: approver.trim(), ...(needsRecipient ? { to: to.trim() } : {}) });
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
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-raised text-muted-foreground">
            <Meta.icon className="size-[18px]" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="text-lg leading-6 font-semibold break-words">{entry.title}</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {entry.subtitle}
              {" · "}
              <Link href={`/items?item=${o.staleItemId}`} className="inline-flex items-center gap-1 underline-offset-2 hover:text-foreground hover:underline">
                Open item <ExternalLink className="size-3" aria-hidden />
              </Link>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {entry.amountCents != null ? <Money cents={entry.amountCents} className="text-xl font-semibold" /> : null}
          <StatusPill status={o.status} />
        </div>
      </div>

      <div className="space-y-6 px-5 py-5">
        <div role="group" aria-label="Channel for this item" className="flex flex-wrap items-center gap-2">
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
                    "h-8 max-sm:h-10 rounded-full border px-3 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                    active ? "border-strong bg-raised text-foreground" : "border-border text-muted-foreground hover:bg-raised hover:text-foreground",
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
                className="inline-flex h-8 max-sm:h-10 items-center gap-1.5 rounded-full border border-dashed border-strong px-3 text-sm text-muted-foreground transition-colors hover:bg-raised hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50"
              >
                <Plus className="size-3.5" aria-hidden />
                {CHANNEL_NEW[c]}
              </button>
            );
          })}
        </div>

        <section aria-labelledby="what-happens">
          <h3 id="what-happens" className="mb-1.5 text-[11px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
            What will happen
          </h3>
          <p className="max-w-[68ch] text-sm leading-6 text-pretty">{what}</p>
        </section>

        <section aria-labelledby="what-sent">
          <h3 id="what-sent" className="mb-1.5 flex items-center gap-2 text-[11px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
            Exactly what will be sent
          </h3>
          {o.channel === "email" && o.subject ? (
            <p className="mb-2 text-sm">
              <span className="text-muted-foreground">Subject: </span>
              {o.subject}
            </p>
          ) : null}
          {o.composed ? (
            <iframe
              title={`${CHANNEL_LABEL[o.channel]} preview`}
              src={`/api/outreach/${o.id}/preview`}
              sandbox=""
              loading="lazy"
              className="h-[min(440px,60vh)] w-full rounded-xl border border-border bg-white"
            />
          ) : (
            <div className="flex min-h-40 flex-col items-start justify-center gap-3 rounded-xl border border-dashed border-strong bg-sunken p-5">
              <p className="max-w-[52ch] text-sm text-muted-foreground">
                The agent queued this {CHANNEL_LABEL[o.channel].toLowerCase()} but has not composed it yet. Compose it to see exactly what the owner will receive, then approve.
              </p>
              <ActionButton variant="primary" pending={busy === "draft"} onClick={() => draft(o.channel)} data-testid="compose-btn">
                Compose {CHANNEL_LABEL[o.channel].toLowerCase()}
              </ActionButton>
            </div>
          )}
        </section>

        <section aria-labelledby="checks">
          <h3 id="checks" className="mb-2 text-[11px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
            Safety checks
          </h3>
          <ul className="space-y-2">
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
              <span className="text-xs text-muted-foreground">Fixed the problem above? Recompose to re-check this draft.</span>
            </div>
          ) : null}
          {needsRecipient && !isDone ? (
            <div className="mt-3 max-w-sm space-y-1">
              <label htmlFor={`to-${o.id}`} className="text-xs font-medium text-muted-foreground">
                Recipient ({o.channel === "email" ? "email" : "phone"})
              </label>
              <input
                id={`to-${o.id}`}
                list={`allow-${o.id}`}
                value={to}
                disabled={isApproved}
                onChange={(e) => setTo(e.target.value)}
                className="h-9 w-full rounded-lg border border-strong bg-sunken px-3 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
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
          <div role="status" data-testid="send-outcome" className="rounded-xl border border-resolved/40 bg-resolved/10 p-3.5 text-sm">
            <p className="font-medium">
              {outcome.offline ? "Offline mode: nothing was sent." : o.channel === "letter" ? "Letter accepted by Lob (test mode)." : o.channel === "email" ? "Email sent." : "Call placed."}
            </p>
            <p className="mt-1 text-muted-foreground">
              {outcome.providerId ? (
                <>
                  {o.channel === "letter" ? "Lob letter" : o.channel === "email" ? "Email id" : "Call id"}: <span className="font-mono text-foreground">{outcome.providerId}</span>
                </>
              ) : (
                "No provider id was returned."
              )}
            </p>
            {outcome.previewUrl ? (
              <a href={outcome.previewUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1.5 text-foreground underline underline-offset-2">
                <FileText className="size-3.5" aria-hidden /> Open Lob preview PDF
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-end gap-x-4 gap-y-3 rounded-b-[14px] border-t border-border px-5 py-4">
        {isDone ? (
          <p className="text-sm text-muted-foreground">
            {o.status === "cancelled" ? "This draft was cancelled." : `Sent${o.sentAt ? ` ${o.sentAt.slice(0, 10)}` : ""}${o.approvedBy ? ` · approved by ${o.approvedBy}` : ""}.`}
          </p>
        ) : (
          <>
            {!isApproved ? <ApproverField value={approver} onChange={setApprover} className="w-full sm:w-52" /> : null}
            <div className="min-w-0 flex-1 text-xs leading-5 text-muted-foreground">
              {isApproved ? (
                <>
                  Approved by <span className="text-foreground">{o.approvedBy ?? "reviewer"}</span>. Editing this draft after approval voids the approval.
                </>
              ) : (
                "Your approval is tied to exactly this content. If the draft changes afterwards, it must be approved again."
              )}
            </div>
            <div className="flex w-full items-center justify-end gap-2 sm:w-auto">
              <ActionButton id="approve-btn" variant="approve" pending={busy === "approve"} disabled={!canApprove} onClick={approve} data-testid="approve-btn">
                {isApproved ? "Approved" : "Approve"}
              </ActionButton>
              <ActionButton variant="primary" pending={busy === "send"} disabled={!canSend} onClick={send} data-testid="send-btn" title={canSend ? undefined : "Approve first. Nothing sends without approval."}>
                {o.channel === "voice" ? "Place call" : "Send"}
              </ActionButton>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
