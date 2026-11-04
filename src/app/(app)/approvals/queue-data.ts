import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  approvals,
  ledgerItems,
  outreach,
  payees,
  recoveries,
  reports,
  ruleChanges,
  staleItems,
} from "@/db/schema";
import { hasLob, isOffline } from "@/lib/env";
import type { RecipientOption } from "@/lib/outreach/recipient-mask";
import { recipientForClient, recipientOptions } from "@/lib/outreach/recipient-ref";
import { formatAddress, getOverdue } from "@/lib/queries";
import { assessOverdue } from "@/lib/overdue";
import type { IsoDate } from "@/lib/dates";
import { outreachContentSha256 } from "@/lib/outreach/util";
import { claimPayloadSha256 } from "@/lib/recoveries/service";
import { PROPERTY_TYPE_LABEL } from "@/lib/format";
import { sentDateOf } from "@/lib/outreach/util";
import { onDemoCalendar } from "@/lib/clock-display";
import { approvalAcknowledgements } from "@/lib/close-out/approve-report";
import { listReadyToApprove } from "@/lib/outreach/bulk";
import { itemNoun, totalCents } from "@/lib/outreach/consolidate";
import { pendingConsolidation } from "@/lib/outreach/notice";
import { itemRowsByOutreach } from "@/lib/letters/notice-items";
import { kindOf } from "@/lib/letters/context";
import { formatUSD } from "@/lib/money";
import { ACTIONABLE_OUTREACH, OWNER_TASK_STATUS } from "./queue-count";
import { plainLanguage } from "./plain-language";

/** Kinds the approvals queue (and the chat tool reading it) lists. */
export type QueueKind = "letter" | "email" | "voice" | "report" | "claim" | "rule";
/** Everything the desk shows: the queue plus owner follow-ups (the owner loop). */
export type DeskKind = QueueKind | "owner";

export interface Readiness {
  ready: boolean;
  problems: string[];
  warnings: string[];
}

/** The discard recorded on an outreach row's tracking by rejectOutreach, or null. */
export function discardOf(tracking: Record<string, unknown> | null | undefined): { by: string; reason: string } | null {
  const r = tracking?.rejected as { by?: unknown; reason?: unknown } | undefined;
  return r && typeof r.by === "string" ? { by: r.by, reason: typeof r.reason === "string" ? r.reason : "" } : null;
}

export interface OutreachView {
  id: string;
  channel: "letter" | "email" | "voice";
  status: string;
  subject: string | null;
  /** Email/voice only; letters render through the preview iframe. */
  body: string | null;
  /**
   * Letters: the postal address. Email/voice: an opaque allowlist ref (R4-24), never the address or number itself;
   * null when the stored recipient is not on the allowlist.
   */
  toAddress: string | null;
  /** Masked email/phone recipient for display ("r•••@gmail.com"); null for letters. */
  toLabel: string | null;
  /** False until a letter/email/script body has been composed for this draft. */
  composed: boolean;
  readiness: Readiness;
  /** Hash of the draft as shown here; sent back on approve so changed content is rejected (M2). */
  contentSha256: string;
  requiredLanguageVerified: boolean | null;
  offline: boolean;
  simulated: boolean;
  providerId: string | null;
  previewUrl: string | null;
  approvedBy: string | null;
  /** Who discarded this draft and why (mirrors the discard audit row on the row's tracking); null if not discarded. */
  discard: { by: string; reason: string } | null;
  approvedAt: string | null;
  sentAt: string | null;
  /** Day the outreach left the queue (real send time, or the offline run's timestamp). */
  sentOn: string | null;
  staleItemId: string;
  ownerName: string;
  ownerAddress: string;
  referenceNumber: string | null;
  propertyLabel: string;
  ruleVersion: string | null;
  dependsOnUnverified: boolean;
  /** Composed, ready and not yet approved (listReadyToApprove): the "Ready" tab. */
  ready: boolean;
  /** A complete owner mailing address is on file (street, city, state and ZIP). */
  hasOwnerAddress: boolean;
  /** Hash of the approved payload, once approved. */
  approvalPayloadSha256: string | null;
  /** What the owner answered through the response link (R3-10), if they did. */
  ownerReply: OwnerReply | null;
  /**
   * One notice per owner: the items a combined letter lists, in letter order, with the total in integer cents.
   * Null for a single-item draft.
   */
  notice: NoticeView | null;
  /** This letter must be combined with another open letter to the same owner and state before it can be approved. */
  combinePending: boolean;
  /** Same item, other channels (any status). */
  siblings: Partial<Record<"letter" | "email" | "voice", { id: string; status: string }>>;
}

export interface NoticeItemView {
  staleItemId: string;
  referenceNumber: string | null;
  issueDate: string;
  amountCents: number;
}

export interface NoticeView {
  items: NoticeItemView[];
  totalCents: number;
  /** "2 checks · $6,126.71" */
  summary: string;
}

export interface OwnerReply {
  intent: "confirm_address" | "already_cashed" | "send_money" | string;
  note: string | null;
  address: string | null;
  receivedAt: string | null;
}

export interface ReportView {
  id: string;
  state: string;
  stage: string | null;
  status: string;
  itemCount: number;
  totalCents: number;
  errorCount: number;
  warningCount: number;
  checksum: string | null;
  /** What the approval must acknowledge ("approve anyway"): UNVERIFIED rule values and never-sent notices. */
  unverifiedCount: number;
  unsentCount: number;
}

export interface ClaimView {
  id: string;
  state: string;
  amountCents: number;
  matchedNameVariant: string | null;
  status: string;
  matchConfidence: number | null;
  /** Hash of the claim payload as shown here; sent back on approve (M2). */
  payloadSha256: string;
}

export interface RuleView {
  id: string;
  state: string;
  fromVersion: string | null;
  toVersion: string | null;
  sourceCount: number;
}

/** Owner loop (R3-10 / R4-10): an owner answered a sent notice; the holder follows up, then marks the item resolved. */
export interface OwnerTaskView {
  staleItemId: string;
  ownerName: string;
  referenceNumber: string | null;
  propertyLabel: string;
  amountCents: number;
  state: string | null;
  /** The holder's task from the recorded reply (verify_and_reissue, verify_cleared, update_address), if recorded. */
  holderTask: string | null;
  /** Date the owner answered (ISO), if recorded. */
  receivedAt: string | null;
  /** The reply itself (choice, note, address), when it came through a notice link. */
  reply: OwnerReply | null;
  /** The status the reviewer saw; Mark resolved is bound to it. */
  status: string;
}

export interface QueueEntry<K extends DeskKind = DeskKind> {
  key: string;
  kind: K;
  title: string;
  subtitle: string;
  amountCents: number | null;
  state: string | null;
  dueDate: string | null;
  /** What dueDate is, so the list never shows a bare date. */
  dueLabel: string | null;
  /** The deadline this approval serves has already passed (shared overdue assessment, src/lib/overdue.ts). */
  overdue?: { label: string; date: string; daysLate: number; verified: boolean } | null;
  statusKey: string;
  actionable: boolean;
  outreach?: OutreachView;
  report?: ReportView;
  claim?: ClaimView;
  rule?: RuleView;
  ownerTask?: OwnerTaskView;
}

export interface QueueData {
  entries: QueueEntry<QueueKind>[];
  /** Owner replies the holder still has to act on; they wait on a person and count in the badge (owner loop). */
  ownerTasks: QueueEntry<"owner">[];
  /** Owner notices Compose all would combine (one notice per owner and state). */
  pendingNotices: number;
  /** Allowlisted test recipients as refs + masked labels only: the full values stay on the server (R4-24). */
  env: { lobConfigured: boolean; offline: boolean; allowedEmails: RecipientOption[]; allowedPhones: RecipientOption[] };
}

const ACTIONABLE = new Set<string>(ACTIONABLE_OUTREACH);

function readinessOf(tracking: Record<string, unknown> | null): { readiness: Readiness; verified: boolean | null } {
  const compose = (tracking?.compose ?? {}) as { readiness?: Partial<Readiness>; requiredLanguageVerified?: boolean };
  const r = compose.readiness ?? {};
  const plain = (xs: string[] | undefined) => [...new Set((xs ?? []).map(plainLanguage).filter(Boolean))];
  return {
    readiness: { ready: r.ready !== false, problems: plain(r.problems), warnings: plain(r.warnings) },
    verified: typeof compose.requiredLanguageVerified === "boolean" ? compose.requiredLanguageVerified : null,
  };
}

function ownerReplyOf(tracking: Record<string, unknown> | null, asOf: string): OwnerReply | null {
  const r = tracking?.response as { intent?: unknown; note?: unknown; address?: unknown; receivedAt?: unknown } | undefined;
  if (!r || typeof r.intent !== "string") return null;
  const a = r.address as { line1?: string; city?: string; state?: string; zip?: string } | null | undefined;
  return {
    intent: r.intent,
    note: typeof r.note === "string" && r.note.trim() ? r.note.trim() : null,
    address: a ? [a.line1, a.city, [a.state, a.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ") : null,
    receivedAt: typeof r.receivedAt === "string" ? onDemoCalendar(r.receivedAt, asOf) : null,
  };
}

const CHANNEL_TITLE = { letter: "Mail due-diligence letter", email: "Send due-diligence email", voice: "Place check-in call" } as const;

/**
 * An unsent letter/email/call still owes the due-diligence notice, so its item counts as "letter not sent" for the
 * shared overdue function whatever the item's status says.
 */
function outreachOverdue(ddWindowEnd: string | null, asOf: IsoDate): NonNullable<QueueEntry["overdue"]> | null {
  const a = assessOverdue(
    { status: "dd_pending", obligations: [{ kind: "dd_window_end", date: ddWindowEnd, status: ddWindowEnd ? "ok" : "not_applicable", verified: true }] },
    asOf,
  );
  return a.earliest ? { label: "Window closed", date: a.earliest.date, daysLate: a.earliest.daysLate, verified: a.earliest.verified } : null;
}

export async function loadQueue(db: Db, companyId: string): Promise<QueueData> {
  const overdueAll = await getOverdue(db, companyId);
  const asOf = overdueAll.asOf;
  const rows = await db
    .select({ o: outreach, s: staleItems, l: ledgerItems })
    .from(outreach)
    .innerJoin(staleItems, eq(staleItems.id, outreach.staleItemId))
    .innerJoin(ledgerItems, eq(ledgerItems.id, staleItems.ledgerItemId))
    .where(eq(outreach.companyId, companyId))
    .orderBy(desc(outreach.createdAt));

  const payeeIds = [...new Set(rows.map((r) => r.s.ownerPayeeId ?? r.l.payeeId).filter((x): x is string => !!x))];
  const payeeRows = payeeIds.length ? await db.select().from(payees).where(inArray(payees.id, payeeIds)) : [];
  const approvalIds = rows.map((r) => r.o.approvalId).filter((x): x is string => !!x);
  const approvalRows = approvalIds.length ? await db.select().from(approvals).where(inArray(approvals.id, approvalIds)) : [];

  const readyIds = new Set((await listReadyToApprove(db, companyId)).map((r) => r.outreachId));
  const pending = await pendingConsolidation(db, companyId);
  const combineIds = new Set(pending.flatMap((g) => g.items.map((i) => i.outreachId)));
  const noticeRows = await itemRowsByOutreach(db, rows.map((r) => r.o.id));
  const noticeStaleIds = [...new Set([...noticeRows.values()].flat())];
  const noticeItems = noticeStaleIds.length
    ? await db
        .select({ id: staleItems.id, amountCents: staleItems.amountCents, ref: ledgerItems.referenceNumber, issueDate: ledgerItems.issueDate, propertyType: staleItems.propertyType })
        .from(staleItems)
        .innerJoin(ledgerItems, eq(ledgerItems.id, staleItems.ledgerItemId))
        .where(inArray(staleItems.id, noticeStaleIds))
    : [];
  const noticeOf = (outreachId: string): NoticeView | null => {
    const ids = noticeRows.get(outreachId);
    if (!ids || ids.length < 2) return null;
    const items = ids.map((id) => noticeItems.find((x) => x.id === id)).filter((x): x is (typeof noticeItems)[number] => Boolean(x));
    const total = totalCents(items);
    const allChecks = items.every((i) => kindOf(i.propertyType) === "check");
    return {
      items: items.map((i) => ({ staleItemId: i.id, referenceNumber: i.ref, issueDate: i.issueDate, amountCents: i.amountCents })),
      totalCents: total,
      summary: `${items.length} ${itemNoun(items.length, allChecks)} · ${formatUSD(total)}`,
    };
  };

  const byItem = new Map<string, OutreachView["siblings"]>();
  for (const { o } of rows) {
    const prev = byItem.get(o.staleItemId) ?? {};
    if (!prev[o.channel]) prev[o.channel] = { id: o.id, status: o.status };
    byItem.set(o.staleItemId, prev);
  }

  const entries: QueueEntry<QueueKind>[] = [];
  for (const { o, s, l } of rows) {
    // A letter folded into its owner's combined notice is not a separate decision any more.
    if (o.status === "cancelled" && typeof o.tracking?.consolidatedInto === "string") continue;
    const payee = payeeRows.find((p) => p.id === (s.ownerPayeeId ?? l.payeeId));
    const ap = approvalRows.find((a) => a.id === o.approvalId);
    const { readiness: baseReadiness, verified } = readinessOf(o.tracking);
    const combinePending = ACTIONABLE.has(o.status) && combineIds.has(o.id);
    const combineProblem = plainLanguage(`another open letter to this owner in ${s.ownerState ?? "this state"} must be combined into one notice first; run Compose all`);
    const readiness = combinePending ? { ...baseReadiness, ready: false, problems: [...new Set([...baseReadiness.problems, combineProblem])] } : baseReadiness;
    const notice = o.channel === "letter" ? noticeOf(o.id) : null;
    const ownerName = payee?.canonicalName ?? l.payeeNameRaw;
    const addr = {
      addressLine: payee?.addressLine ?? l.addressLine,
      city: payee?.city ?? l.city,
      state: payee?.state ?? l.state,
      zip: payee?.zip ?? l.zip,
    };
    const recipient = o.channel === "letter" ? { to: o.toAddress, label: null } : recipientForClient(o.channel, o.toAddress);
    const view: OutreachView = {
      id: o.id,
      channel: o.channel,
      status: o.status,
      subject: o.subject,
      body: o.channel === "letter" ? null : o.channel === "voice" ? o.body : o.body ? stripHtml(o.body) : null,
      toAddress: recipient.to,
      toLabel: recipient.label,
      composed: o.body !== null && o.body.trim() !== "",
      readiness,
      contentSha256: outreachContentSha256(o),
      requiredLanguageVerified: verified,
      offline: o.offline,
      simulated: o.tracking?.simulated === true,
      providerId: o.providerId,
      previewUrl: o.previewUrl,
      approvedBy: ap?.approvedBy ?? null,
      discard: discardOf(o.tracking),
      approvedAt: ap?.approvedAt?.toISOString() ?? null,
      sentAt: o.sentAt?.toISOString() ?? null,
      sentOn: onDemoCalendar(sentDateOf(o), asOf),
      staleItemId: o.staleItemId,
      ownerName,
      ownerAddress: formatAddress(addr),
      hasOwnerAddress: Boolean(addr.addressLine?.trim() && addr.city?.trim() && addr.state?.trim() && addr.zip?.trim()),
      ready: readyIds.has(o.id) && !combinePending,
      approvalPayloadSha256: ap?.payloadSha256 ?? null,
      ownerReply: ownerReplyOf(o.tracking, asOf),
      referenceNumber: l.referenceNumber,
      propertyLabel: PROPERTY_TYPE_LABEL[s.propertyType] ?? s.propertyType,
      ruleVersion: s.ruleVersion,
      dependsOnUnverified: s.dependsOnUnverified,
      siblings: byItem.get(o.staleItemId) ?? {},
      notice,
      combinePending,
    };
    entries.push({
      key: `o:${o.id}`,
      kind: o.channel,
      title: `${CHANNEL_TITLE[o.channel]} · ${ownerName}`,
      subtitle: notice
        ? [notice.summary, s.ownerState].filter(Boolean).join(" · ")
        : [l.referenceNumber ? `#${l.referenceNumber}` : null, view.propertyLabel, s.ownerState].filter(Boolean).join(" · "),
      amountCents: notice ? notice.totalCents : s.amountCents,
      state: s.ownerState,
      dueDate: s.ddWindowEnd ?? s.reportDueDate,
      dueLabel: s.ddWindowEnd ? "Send by" : s.reportDueDate ? "Report due" : null,
      overdue: ACTIONABLE.has(o.status) ? outreachOverdue(s.ddWindowEnd, asOf) : null,
      statusKey: o.status === "sent" && o.offline ? "sent_offline" : o.status,
      actionable: ACTIONABLE.has(o.status),
      outreach: view,
    });
  }

  /** Earliest missed report/remit date among this state's open items, if any. */
  const reportOverdue = (state: string): NonNullable<QueueEntry["overdue"]> | null => {
    const missed = overdueAll.items
      .filter((i) => i.state === state)
      .flatMap((i) => i.overdue.filter((o) => o.kind !== "dd_window_end"))
      .sort((a, b) => b.daysLate - a.daysLate)[0];
    return missed
      ? { label: missed.kind === "remit_due" ? "Remit was due" : "Report was due", date: missed.date, daysLate: missed.daysLate, verified: missed.verified }
      : null;
  };

  const reportRows = await db
    .select()
    .from(reports)
    .where(eq(reports.companyId, companyId))
    .orderBy(desc(reports.createdAt));
  for (const r of reportRows.filter((x) => ["validated", "awaiting_approval", "approved"].includes(x.status))) {
    const errs = (r.validationErrors ?? []) as { severity?: string }[];
    const acks = r.status === "approved" ? { unverified: 0, unsent: 0 } : await approvalAcknowledgements(db, companyId, r.state);
    entries.push({
      key: `r:${r.id}`,
      kind: "report",
      title: `Submit ${r.state} unclaimed property report`,
      subtitle: `${r.itemCount} items · NAUPA file · ${r.stage ?? "annual"} stage`,
      amountCents: r.totalCents,
      state: r.state,
      dueDate: null,
      dueLabel: null,
      overdue: reportOverdue(r.state),
      statusKey: r.status === "approved" ? "approved" : "awaiting_approval",
      actionable: r.status !== "approved",
      report: {
        id: r.id,
        state: r.state,
        stage: r.stage,
        status: r.status,
        itemCount: r.itemCount,
        totalCents: r.totalCents,
        errorCount: errs.filter((e) => e.severity === "error").length,
        warningCount: errs.filter((e) => e.severity === "warning").length,
        checksum: r.checksum,
        unverifiedCount: acks.unverified,
        unsentCount: acks.unsent,
      },
    });
  }

  const recRows = await db.select().from(recoveries).where(eq(recoveries.companyId, companyId));
  for (const r of recRows.filter((x) => ["found", "claim_drafted", "awaiting_approval"].includes(x.status))) {
    entries.push({
      key: `c:${r.id}`,
      kind: "claim",
      title: `File ${r.state} claim for money owed to you`,
      subtitle: `Matched “${r.matchedNameVariant ?? r.holderNameFound ?? "name variant"}” on the replica ${r.state} portal`,
      amountCents: r.amountCents,
      state: r.state,
      dueDate: null,
      dueLabel: null,
      statusKey: r.approvalId ? "approved" : "awaiting_approval",
      actionable: !r.approvalId,
      claim: {
        id: r.id,
        state: r.state,
        amountCents: r.amountCents,
        matchedNameVariant: r.matchedNameVariant,
        status: r.status,
        matchConfidence: r.matchConfidence,
        payloadSha256: await claimPayloadSha256(db, r),
      },
    });
  }

  const ruleRows = await db.select().from(ruleChanges).where(eq(ruleChanges.status, "proposed"));
  for (const r of ruleRows) {
    entries.push({
      key: `x:${r.id}`,
      kind: "rule",
      title: `Review ${r.state} rule change`,
      subtitle: `${r.fromVersion ?? "none"} to ${r.toVersion ?? "new version"} · ${r.sourceUrls.length} sources`,
      amountCents: null,
      state: r.state,
      dueDate: null,
      dueLabel: null,
      statusKey: "awaiting_approval",
      actionable: true,
      rule: { id: r.id, state: r.state, fromVersion: r.fromVersion, toVersion: r.toVersion, sourceCount: r.sourceUrls.length },
    });
  }

  const ownerTasks = await ownerTaskEntries(db, companyId, rows.map((r) => r.o), asOf);

  entries.sort((a, b) => {
    if (a.actionable !== b.actionable) return a.actionable ? -1 : 1;
    const ad = a.dueDate ?? "9999";
    const bd = b.dueDate ?? "9999";
    if (ad !== bd) return ad < bd ? -1 : 1;
    return (b.amountCents ?? 0) - (a.amountCents ?? 0);
  });

  const done = entries.filter((e) => !e.actionable);
  const todo = entries.filter((e) => e.actionable);
  return {
    entries: [...todo, ...done.slice(0, 8)],
    ownerTasks,
    pendingNotices: pending.length,
    env: { lobConfigured: hasLob(), offline: isOffline(), allowedEmails: recipientOptions("email"), allowedPhones: recipientOptions("voice") },
  };
}

function ownerTaskTitle(holderTask: string | null, amount: string, ownerName: string): string {
  if (holderTask === "verify_cleared") return `Confirm ${ownerName}'s ${amount} cleared`;
  if (holderTask === "update_address") return `Re-mail ${amount} to ${ownerName} at the new address`;
  return `Reissue ${amount} to ${ownerName}`;
}

/** One row per item an owner answered for (status owner_responded): it waits on the holder until marked resolved. */
async function ownerTaskEntries(db: Db, companyId: string, outreachRows: readonly (typeof outreach.$inferSelect)[], asOf: string): Promise<QueueEntry<"owner">[]> {
  const items = await db
    .select({ s: staleItems, l: ledgerItems, p: payees })
    .from(staleItems)
    .innerJoin(ledgerItems, eq(ledgerItems.id, staleItems.ledgerItemId))
    .leftJoin(payees, eq(payees.id, staleItems.ownerPayeeId))
    .where(and(eq(staleItems.companyId, companyId), eq(staleItems.status, OWNER_TASK_STATUS)));
  return items.map(({ s, l, p }): QueueEntry<"owner"> => {
    const resp = ((s.classification ?? {}) as { ownerResponse?: { holderTask?: unknown; at?: unknown; outreachId?: unknown } }).ownerResponse;
    const holderTask = typeof resp?.holderTask === "string" ? resp.holderTask : null;
    const receivedAt = typeof resp?.at === "string" ? onDemoCalendar(resp.at, asOf) : null;
    const source = outreachRows.find((o) => o.id === resp?.outreachId);
    const ownerName = p?.canonicalName ?? l.payeeNameRaw;
    return {
      key: `t:${s.id}`,
      kind: "owner",
      title: ownerTaskTitle(holderTask, formatUSD(s.amountCents), ownerName),
      subtitle: ["Owner replied", l.referenceNumber ? `#${l.referenceNumber}` : null, s.ownerState].filter(Boolean).join(" · "),
      amountCents: s.amountCents,
      state: s.ownerState,
      dueDate: null,
      dueLabel: null,
      statusKey: OWNER_TASK_STATUS,
      actionable: true,
      ownerTask: {
        staleItemId: s.id,
        ownerName,
        referenceNumber: l.referenceNumber,
        propertyLabel: PROPERTY_TYPE_LABEL[s.propertyType] ?? s.propertyType,
        amountCents: s.amountCents,
        state: s.ownerState,
        holderTask,
        receivedAt,
        reply: source ? ownerReplyOf(source.tracking, asOf) : null,
        status: s.status,
      },
    };
  });
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The list header's "Waiting on you": actionable queue entries plus owner follow-ups (must equal countWaiting). */
export function waitingInQueue(q: Pick<QueueData, "entries" | "ownerTasks">): number {
  return q.entries.filter((e) => e.actionable).length + q.ownerTasks.filter((e) => e.actionable).length;
}
