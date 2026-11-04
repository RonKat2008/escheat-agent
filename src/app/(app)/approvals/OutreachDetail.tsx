"use client";

import { isValidApproverName } from "@/lib/auth/approver";
import { formatDate } from "@/lib/format";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type RefObject } from "react";
import { CheckCircle2, ExternalLink, FileText } from "lucide-react";
import { ActionButton } from "@/components/b/ActionButton";
import { ApiProblem } from "@/components/b/ApiProblem";
import { ApproverField, useApprover } from "@/components/b/ApproverField";
import { postJson, type ApiFailure } from "@/components/b/api";
import { InstrumentLabel, Kbd, Money, StatusPill } from "@/components/primitives";
import { ariaKeys, keyChips, shortcutById } from "@/components/shell/shortcuts";
import { FlipStamp, Stamp } from "@/components/viz/flip-stamp/FlipStamp";
import { toOperatorMessage } from "@/lib/settings/operator-copy";
import { cn } from "@/lib/utils";
import { AddressFix } from "./AddressFix";
import { ApprovalTitle } from "./ApprovalTitle";
import { approveBlockReason } from "./approve-block";
import { CHANNEL_LABEL, ChannelSequence } from "./ChannelSequence";
import { DeskPreview } from "./DeskPreview";
import { DiscardDraft } from "./DiscardDraft";
import { sequenceOf, type QueueGroup, type SequenceChannel } from "./group";
import { KIND_META } from "./kinds";
import { notify } from "./notify";
import { isAllowlisted, outreachChecks } from "./outreach-checks";
import { isRecipientRef, refForTyped } from "@/lib/outreach/recipient-mask";
import { OverdueNote } from "./OverdueNote";
import { NoticeItems, SequenceCadence } from "./NoticeItems";
import { OwnerReplyPanel } from "./OwnerReplyPanel";
import type { QueueData, QueueEntry } from "./queue-data";
import { SafetyChecks } from "./SafetyChecks";

interface SendOutcome {
  sent: boolean;
  offline: boolean;
  providerId: string | null;
  previewUrl: string | null;
  status: string;
}

/** What the page's keyboard handler can ask of the open detail (a, ⌘↵, e). */
export interface DetailActions {
  /** Approve this draft. Resolves true when the approval was recorded. Null when approval is not possible now. */
  approve: (() => Promise<boolean>) | null;
  /** Focus the compose / recompose control (the "edit" key). */
  edit: () => void;
}

/** Browser-side ref of a typed recipient (R4-24), so a typed allowlisted address is recognised without the full list. */
function useTypedRecipientRef(channel: "letter" | "email" | "voice", to: string): string | null {
  const [state, setState] = useState<{ for: string; ref: string | null }>({ for: "", ref: null });
  useEffect(() => {
    if (channel === "letter" || isRecipientRef(to) || !to.trim()) return;
    let live = true;
    void refForTyped(channel, to).then((ref) => {
      if (live) setState({ for: to, ref });
    });
    return () => {
      live = false;
    };
  }, [channel, to]);
  return state.for === to ? state.ref : null;
}

const APPROVE_KEYS = shortcutById("approve")?.keys ?? ["a"];
const APPROVE_NEXT_KEYS = shortcutById("approve-next")?.keys ?? ["mod+enter"];

function SealFront({ entry, status }: { entry: QueueEntry; status: string }) {
  return (
    <div className="flex min-h-[92px] min-w-[200px] flex-col items-end justify-center gap-1.5 rounded-[10px] border border-line bg-ink-2 px-4 py-3">
      {entry.amountCents != null ? <Money cents={entry.amountCents} className="text-2xl font-medium tracking-[-0.02em] text-fg-1" /> : null}
      <StatusPill status={status} />
    </div>
  );
}

function SealBack({ entry, approver, hash, land }: { entry: QueueEntry; approver: string | null; hash: string | null; land: boolean }) {
  return (
    <div className="flex min-h-[92px] min-w-[200px] flex-col items-end justify-center gap-1.5 rounded-[10px] border border-blue-700 bg-blue-950 px-4 py-3">
      <Stamp land={land}>
        <CheckCircle2 className="size-3.5" strokeWidth={2} aria-hidden />
        Approved
      </Stamp>
      {entry.amountCents != null ? <Money cents={entry.amountCents} className="text-[13px] text-fg-1" /> : null}
      <span className="text-[11px] text-fg-2">Approver: {approver ?? "reviewer"}</span>
      {hash ? <span className="font-mono text-[11px] text-fg-3">payload {hash.slice(0, 12)}</span> : null}
    </div>
  );
}

export function OutreachDetail({
  entry,
  group,
  env,
  onSelectKey,
  actionsRef,
}: {
  entry: QueueEntry;
  group: QueueGroup | null;
  env: QueueData["env"];
  onSelectKey: (key: string) => void;
  actionsRef: RefObject<DetailActions | null>;
}) {
  const o = entry.outreach!;
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [approver, setApprover] = useApprover();
  const allow = o.channel === "email" ? env.allowedEmails : o.channel === "voice" ? env.allowedPhones : [];
  // R3-16: never prefill from the allowlist. R4-24: `to` is an opaque allowlist ref (shown masked) or what the reviewer typed.
  const [to, setTo] = useState(o.toAddress ?? "");
  const typedRef = useTypedRecipientRef(o.channel, to);
  const [busy, setBusy] = useState<"approve" | "send" | "draft" | null>(null);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [outcome, setOutcome] = useState<SendOutcome | null>(null);
  /** Set when this reviewer approved in this view: the flip and stamp play once instead of a silent swap. */
  const [justApproved, setJustApproved] = useState<{ hash: string } | null>(null);

  const needsRecipient = o.channel !== "letter";
  const allowlisted = isAllowlisted(o.channel, to, allow) || (typedRef !== null && isAllowlisted(o.channel, typedRef, allow));
  const shownTo = isRecipientRef(to) ? (allow.find((a) => a.ref === to)?.label ?? o.toLabel ?? "") : to;
  const isDone = ["sent", "delivered", "responded", "cancelled"].includes(o.status);
  const isApproved = o.status === "approved" || (justApproved !== null && !isDone);
  const canApprove = !isDone && !isApproved && o.composed && o.readiness.ready && allowlisted && isValidApproverName(approver) && (!needsRecipient || to.trim().length > 0);
  const canSend = isApproved && !isDone;
  const sentOffline = o.status === "sent" && o.offline;
  const approveBlock = isDone || isApproved ? null : approveBlockReason({ composed: o.composed, problems: o.readiness.problems, needsRecipient, to, allowlisted, approver });
  const Meta = KIND_META[o.channel];
  const missingAddress = o.channel === "letter" && !o.hasOwnerAddress && !isDone;
  const seq = group ? sequenceOf(group) : {};
  const steps = Object.fromEntries(Object.entries(seq).map(([c, e]) => [c, { key: e!.key, status: e!.statusKey }]));

  const refresh = () => startTransition(() => router.refresh());

  async function approve(): Promise<boolean> {
    setBusy("approve");
    setFailure(null);
    const r = await postJson<{ payloadSha256?: string }>(`/api/outreach/${o.id}/approve`, {
      approvedBy: approver.trim(),
      expectedContentSha256: o.contentSha256,
      ...(needsRecipient ? { to: to.trim() } : {}),
    });
    setBusy(null);
    if (!r.ok) {
      setFailure(r);
      return false;
    }
    setJustApproved({ hash: r.data.payloadSha256 ?? "" });
    notify.success("Approval recorded", {
      description: `Tied to this exact content. Nothing has been sent yet: ${o.channel === "voice" ? "place the call" : "send it"} when you are ready.`,
    });
    refresh();
    return true;
  }

  async function send() {
    setBusy("send");
    setFailure(null);
    const r = await postJson<SendOutcome>(`/api/outreach/${o.id}/send`, needsRecipient ? { to: to.trim() } : {});
    setBusy(null);
    if (!r.ok) return setFailure(r);
    setOutcome(r.data);
    notify.success(r.data.offline ? "Offline: nothing was sent." : r.data.sent ? "Sent in test mode." : "Done.");
    refresh();
  }

  async function draft(channel: SequenceChannel) {
    setBusy("draft");
    setFailure(null);
    const r = await postJson<{ drafted: true; outreachId: string } | { drafted: false; reason: string }>("/api/outreach/draft", { staleItemId: o.staleItemId, channel });
    setBusy(null);
    if (!r.ok) return setFailure(r);
    if (!r.data.drafted) {
      notify.warning(`Not drafted: ${r.data.reason}`);
      return;
    }
    notify.success(`${CHANNEL_LABEL[channel]} draft ${channel === o.channel ? "composed" : "created"}.`);
    refresh();
    onSelectKey(`o:${r.data.outreachId}`);
  }

  // Keyboard (a / ⌘↵ / e) reaches this draft through the page's handler.
  useEffect(() => {
    actionsRef.current = {
      approve: canApprove && busy === null ? approve : null,
      edit: () => (document.querySelector<HTMLElement>("[data-testid='compose-btn'], [data-testid='recompose-btn']") ?? document.getElementById("approve-btn"))?.focus(),
    };
    return () => {
      actionsRef.current = null;
    };
  });

  const checks = outreachChecks(o, env, to, allowlisted, allow.length);
  const what =
    o.channel === "letter"
      ? o.hasOwnerAddress
        ? o.notice
          ? `One due-diligence letter listing ${o.notice.summary} will be mailed to ${o.ownerAddress} through Lob in test mode. No real mail is produced.`
          : `A due-diligence letter will be mailed to ${o.ownerAddress} through Lob in test mode. No real mail is produced.`
        : "A due-diligence letter, once there is a complete mailing address for the owner. Nothing can be mailed until then."
      : o.channel === "email"
        ? "One email will be sent to the recipient below. It links to the owner's reply page."
        : "A simulated check-in call will be placed to the recipient below using the script shown.";

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4 px-6 pt-6 pb-5">
        <div className="min-w-0 flex-1">
          <InstrumentLabel as="p" className="flex items-center gap-1.5">
            <Meta.icon className="size-3.5" strokeWidth={1.5} aria-hidden />
            {Meta.label}
          </InstrumentLabel>
          <h2 tabIndex={-1} data-detail-heading className="mt-1 text-xl leading-7 font-semibold tracking-[-0.015em] break-words text-fg-1 outline-none focus-visible:underline focus-visible:decoration-blue-400 focus-visible:underline-offset-4">
            <ApprovalTitle title={entry.title} />
          </h2>
          <p className="mt-1 text-[13px] text-fg-2">
            {entry.subtitle}
            <Link href={`/items?item=${o.staleItemId}`} className="ml-3 inline-flex items-center gap-1 text-blue-400 underline-offset-2 hover:text-blue-300 hover:underline">
              Open item <ExternalLink className="size-3" strokeWidth={1.5} aria-hidden />
            </Link>
          </p>
          <OverdueNote overdue={entry.overdue} className="mt-2" />
        </div>
        <FlipStamp
          flipped={isApproved}
          animate={justApproved !== null}
          front={<SealFront entry={entry} status={sentOffline ? "sent_offline" : o.status} />}
          back={<SealBack entry={entry} approver={o.approvedBy ?? (justApproved ? approver.trim() : null)} hash={justApproved?.hash || o.approvalPayloadSha256} land={justApproved !== null} />}
        />
      </div>

      <div className="space-y-7 px-6 pb-10">
        <div>
          <ChannelSequence steps={steps} active={o.channel} disabled={busy !== null} onOpen={onSelectKey} onDraft={draft} />
          <SequenceCadence />
        </div>

        {o.notice ? <NoticeItems notice={o.notice} /> : null}

        {o.ownerReply ? <OwnerReplyPanel reply={o.ownerReply} staleItemId={o.staleItemId} /> : null}

        {missingAddress ? (
          <AddressFix
            ownerName={o.ownerName}
            addressOnFile={o.ownerAddress}
            staleItemId={o.staleItemId}
            emailDraftKey={seq.email?.key ?? null}
            pending={busy === "draft"}
            onDraftEmail={() => draft("email")}
            onOpenEmail={onSelectKey}
          />
        ) : null}

        <section aria-labelledby="what-happens">
          <h3 id="what-happens" className="mb-1.5 text-[13px] font-medium text-fg-1">
            What will happen
          </h3>
          <p className="max-w-[68ch] text-[13px] leading-6 text-pretty text-fg-2">{what}</p>
        </section>

        <section aria-labelledby="what-sent">
          <h3 id="what-sent" className="mb-2.5 text-[13px] font-medium text-fg-1">
            Exactly what will be sent
          </h3>
          {o.channel === "email" && o.subject ? (
            <p className="mb-2.5 text-[13px] text-fg-1">
              <span className="text-fg-3">Subject </span>
              {o.subject}
            </p>
          ) : null}
          {o.composed ? (
            <DeskPreview outreachId={o.id} channel={o.channel} channelLabel={CHANNEL_LABEL[o.channel]} icon={Meta.icon} contentSha256={o.contentSha256} />
          ) : (
            <div className="es-desk flex min-h-48 flex-col items-start justify-center gap-3 rounded-[14px] border border-line p-5">
              <p className="max-w-[52ch] text-[13px] text-fg-2">
                The agent queued this {CHANNEL_LABEL[o.channel].toLowerCase()} but has not composed it yet. Compose it to see exactly what the owner will receive, then approve.
              </p>
              <ActionButton variant="primary" pending={busy === "draft"} onClick={() => draft(o.channel)} data-testid="compose-btn" aria-keyshortcuts="E">
                Compose {CHANNEL_LABEL[o.channel].toLowerCase()}
              </ActionButton>
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
              <ActionButton variant="quiet" pending={busy === "draft"} onClick={() => draft(o.channel)} data-testid="recompose-btn" aria-keyshortcuts="E">
                Recompose draft
              </ActionButton>
              <span className="text-xs text-fg-3">Fixed the problem above? Recompose to re-check this draft.</span>
            </div>
          ) : null}
          {needsRecipient && !isDone ? (
            <div className="mt-3 max-w-sm space-y-1">
              <label htmlFor={`to-${o.id}`} className="text-xs text-fg-3">
                Recipient ({o.channel === "email" ? "email" : "phone"}, test allowlist only)
              </label>
              <input
                id={`to-${o.id}`}
                value={shownTo}
                disabled={isApproved}
                placeholder={o.channel === "email" ? "Pick an allowlisted test address below" : "Pick an allowlisted test number below"}
                autoComplete="off"
                onChange={(e) => setTo(e.target.value)}
                data-testid="recipient-input"
                className="h-8 w-full rounded-md border border-line-hover bg-ink-2 px-2.5 font-mono text-[13px] text-fg-1 transition-[border-color] duration-150 outline-none placeholder:font-sans placeholder:text-fg-3 hover:border-line-strong focus-visible:border-blue-400 focus-visible:outline-none disabled:opacity-60 max-sm:h-10"
              />
              {allow.length > 0 ? (
                <div className="flex flex-wrap items-center gap-1.5 pt-1" role="group" aria-label={`Allowlisted test ${o.channel === "email" ? "addresses" : "numbers"}`} data-testid="allowlist-chips">
                  {allow.map((a) => (
                    <button
                      key={a.ref}
                      type="button"
                      disabled={isApproved}
                      aria-pressed={to === a.ref || typedRef === a.ref}
                      onClick={() => setTo(a.ref)}
                      data-testid="allowlist-chip"
                      className="max-w-full truncate rounded-full border border-line-hover bg-ink-2 px-2.5 py-1 font-mono text-xs text-fg-1 transition-colors duration-150 hover:border-blue-400 hover:text-blue-300 focus-visible:border-blue-400 focus-visible:outline-none aria-pressed:border-blue-400 aria-pressed:text-blue-300 disabled:opacity-60 max-sm:py-2"
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-fg-3" data-testid="allowlist-empty">
                  {toOperatorMessage(o.channel === "email" ? "ALLOWED_TEST_RECIPIENTS" : "ALLOWED_TEST_PHONES").plain}
                </p>
              )}
            </div>
          ) : null}
        </section>

        {failure?.code === "recipient_not_allowed" ? (
          <div role="alert" data-testid="recipient-refused" className="rounded-lg border border-pink-400 p-3.5 text-[13px] text-fg-1">
            <p className="font-medium">That recipient is not on the test list</p>
            <p className="mt-1 text-fg-2">{toOperatorMessage(o.channel === "voice" ? "ALLOWED_TEST_PHONES" : "ALLOWED_TEST_RECIPIENTS").plain} Nothing was sent.</p>
          </div>
        ) : failure ? (
          <ApiProblem failure={{ ...failure, error: toOperatorMessage(failure.error).plain }} />
        ) : null}

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

      <div className="sticky bottom-0 z-10 flex flex-wrap items-end gap-x-4 gap-y-3 border-t border-line bg-ink-1 px-6 py-4" data-testid="approve-bar">
        {isDone ? (
          <p className="text-[13px] text-fg-2">
            {o.status === "cancelled"
              ? "This draft was cancelled."
              : `${sentOffline ? "Sent (offline — nothing mailed)" : o.status === "responded" ? "Sent, and the owner replied" : "Sent"}${o.sentOn ? ` on ${formatDate(o.sentOn)}` : ""}${o.approvedBy ? ` · approved by ${o.approvedBy}` : ""}.`}
          </p>
        ) : (
          <>
            {!isApproved ? <ApproverField value={approver} onChange={setApprover} className="w-full sm:w-52" /> : null}
            <div className="min-w-[14rem] flex-1 text-xs leading-5 text-fg-3" role="status">
              {isApproved ? (
                <span className={cn("block", justApproved && "es-detail-in")}>
                  Approved by <span className="text-fg-1">{o.approvedBy ?? approver.trim() ?? "reviewer"}</span>. Editing this draft after approval voids the approval.
                </span>
              ) : (
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  Your approval is tied to exactly this content.
                  <span className="hidden items-center gap-1 lg:inline-flex">
                    <Kbd keys={keyChips(APPROVE_KEYS)} /> approve <Kbd keys={keyChips(APPROVE_NEXT_KEYS)} /> approve and next
                  </span>
                </span>
              )}
            </div>
            {approveBlock ? (
              <p id="approve-blocked" data-testid="approve-blocked" className="w-full text-xs leading-5 text-pink-300">
                Can&apos;t approve yet: {approveBlock}
              </p>
            ) : null}
            <div className="flex w-full items-center justify-end gap-2 sm:w-auto">
              {!isApproved ? <DiscardDraft outreachId={o.id} approver={approver} disabled={busy !== null} onDone={refresh} /> : null}
              <ActionButton
                id="approve-btn"
                variant={isApproved ? "quiet" : "approve"}
                pending={busy === "approve"}
                disabled={!canApprove}
                onClick={approve}
                data-testid="approve-btn"
                title={approveBlock ?? undefined}
                aria-describedby={approveBlock ? "approve-blocked" : undefined}
                aria-keyshortcuts={`${ariaKeys(APPROVE_KEYS)} ${ariaKeys(APPROVE_NEXT_KEYS)}`}
              >
                {isApproved ? (
                  <>
                    <CheckCircle2 className="size-4 text-blue-400" strokeWidth={2} aria-hidden />
                    Approved
                  </>
                ) : (
                  "Approve"
                )}
              </ActionButton>
              <ActionButton
                variant={canSend ? "primary" : "quiet"}
                pending={busy === "send"}
                disabled={!canSend}
                onClick={send}
                data-testid="send-btn"
                title={canSend ? undefined : "Approve first. Nothing sends without approval."}
              >
                {o.channel === "voice" ? "Place call" : "Send"}
              </ActionButton>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
