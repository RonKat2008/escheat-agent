/**
 * Server-side loaders for the Ask approval-class cards (docs/ASK-MODE.md slice 4). Every number, date, hash and rule
 * flag here is read from the same code the pages use: the Approvals queue (loadQueue), the chat approval card
 * (approvalCard), the shared draft-eligibility check, the ledger close previews (closePreviews) and the close-out
 * snapshot. Nothing here writes, approves or decides a legal value.
 */
import { and, asc, eq, gte, ilike, inArray, isNotNull, lte, notExists, notInArray, or, sql } from "drizzle-orm";
import { ledgerItems, outreach, reports, staleItems } from "@/db/schema";
import { loadQueue, type QueueEntry, type QueueKind } from "@/app/(app)/approvals/queue-data";
import { approvalCard } from "@/lib/chat/tools/actions";
import { checkDraftEligibility } from "@/lib/outreach/draft";
import { CLOSED_STATUSES, today } from "@/lib/queries/common";
import { findStaleItemId } from "@/lib/queries/items";
import { computeLedger, ledgerMovements, loadLedger } from "@/lib/queries/ledger";
import { closePreviews, listClosedPeriods } from "@/lib/close-pack/close";
import { isMonthId, monthLabel, monthPeriod, monthsWithActivity } from "@/lib/close-pack/period";
import { approvalAcknowledgements } from "@/lib/close-out/approve-report";
import { loadCloseSnapshot } from "@/lib/close-out/plan";
import { tryLoadRules } from "@/lib/rules/load";
import { listRuleValues } from "@/lib/rules/values";
import { nextClosableMonth } from "@/lib/ledger/closes";
import type { Movement } from "@/lib/ledger/movements";
import { adjustmentOf, type Roll } from "@/lib/ledger/rollforward";
import type { ChatToolContext } from "@/lib/chat/tools/define";
import type {
  ApprovalsReviewUi,
  DraftCandidate,
  FilingCardUi,
  OutreachDraftsUi,
  PeriodCloseUi,
  ReviewGroup,
  ReviewKind,
  ReviewRow,
  TieStateLine,
} from "./approval-ui-types";

/** Rows shown per action group on the review card; the group says how many more wait in Approvals. */
export const REVIEW_ROWS_PER_GROUP = 4;
/** Draftable items listed on the draft-outreach card when no item was named. */
export const DRAFT_CANDIDATES = 6;
/** Already-drafted letters previewed on the draft-outreach card. */
export const DRAFT_PREVIEWS = 3;

const GROUP_ORDER: readonly ReviewKind[] = ["letter", "email", "voice", "report", "claim", "rule"];
const GROUP_LABEL: Record<ReviewKind, string> = {
  letter: "Mail letters",
  email: "Send emails",
  voice: "Place calls",
  report: "Submit reports",
  claim: "File claims",
  rule: "Apply rule changes",
};
const IRREVERSIBLE: Record<ReviewKind, string> = {
  letter: "Mailing it (Lob test mode only) is a separate Send step in Approvals.",
  email: "Sending it (allowlisted test recipients only) is a separate Send step in Approvals.",
  voice: "Placing the call (allowlisted test numbers only) is a separate step in Approvals.",
  report: "Filing happens only on the replica state portal, by the filing agent, which checks this approval first.",
  claim: "The claim is filed only on the replica state portal, by the claim agent, which checks this approval first.",
  rule: "Adopting a rule change changes every deadline it drives; it is reviewed against its cited sources on Rules.",
};
const OUTREACH_WAITING = new Set(["draft", "awaiting_approval"]);
/** Mirrors REFUSING_CODES in src/lib/outreach/draft.ts (assertDraftable): these refuse; every other skip code is advisory. */
const REFUSING_CODES: readonly string[] = ["closed", "window_not_open"];

const href = (key: string) => `/approvals?sel=${encodeURIComponent(key)}`;
const n = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** Entries still waiting for a person's approval (not approved yet, not a failed send). */
export function waitingForApproval(entries: readonly QueueEntry<QueueKind>[]): QueueEntry<QueueKind>[] {
  return entries.filter((e) => e.actionable && e.statusKey !== "approved" && (!e.outreach || OUTREACH_WAITING.has(e.outreach.status)));
}

async function outreachRow(ctx: ChatToolContext, e: QueueEntry<QueueKind>): Promise<ReviewRow> {
  const o = e.outreach!;
  const card = o.channel === "letter" ? await approvalCard(ctx, o.id, false) : null;
  const blockers = [...o.readiness.problems];
  if (o.channel !== "letter") blockers.push("Pick the allowlisted test recipient in Approvals before approving.");
  else if (!o.composed) blockers.push("Not composed yet. Compose it in Approvals first.");
  else if (card && !card.fullyShown) blockers.push("Part of this letter cannot be shown here. Review the full letter in Approvals.");
  const inline = o.channel === "letter" && o.ready && blockers.length === 0 && card !== null && card.contentSha256 === o.contentSha256;
  const recipient = o.channel === "letter" ? (card?.toAddressLines.length ? card.toAddressLines : [o.ownerName, o.ownerAddress].filter(Boolean)) : [o.toLabel ?? `${o.ownerName} (recipient picked in Approvals)`];
  return {
    key: e.key,
    kind: e.kind,
    title: e.title,
    subtitle: e.subtitle,
    amountCents: e.amountCents,
    state: e.state,
    recipient,
    payload: [
      o.notice ? `Combined notice: ${o.notice.summary}` : `${o.propertyLabel}${o.referenceNumber ? ` #${o.referenceNumber}` : ""}`,
      ...(o.subject ? [`Subject: ${o.subject}`] : []),
      `Rule file ${o.ruleVersion ?? "UNKNOWN"}; notice wording comes from the rule file.`,
    ],
    approveEffect: "Records your approval of exactly this content. Nothing is mailed, emailed or called.",
    irreversible: IRREVERSIBLE[e.kind],
    unverified: o.dependsOnUnverified || o.requiredLanguageVerified === false,
    blockers: [...new Set(blockers)],
    bodyText: card && card.fullyShown ? card.bodyText : null,
    approve: inline ? { kind: "outreach", outreachId: o.id, contentSha256: o.contentSha256 } : null,
    openHref: href(e.key),
  };
}

function reportRow(e: QueueEntry<QueueKind>): ReviewRow {
  const r = e.report!;
  const blockers = [
    ...(r.errorCount > 0 ? [`${n(r.errorCount, "validation error")}. Fix them in Reports and regenerate before approving.`] : []),
    ...(r.checksum ? [] : ["The file has no checksum yet. Regenerate it in Reports."]),
  ];
  return {
    key: e.key,
    kind: "report",
    title: e.title,
    subtitle: e.subtitle,
    amountCents: e.amountCents,
    state: e.state,
    recipient: [`Replica ${r.state} unclaimed property portal`],
    payload: [
      `${n(r.itemCount, "item")} in the NAUPA file, ${r.stage ?? "annual"} stage`,
      `${n(r.errorCount, "error")}, ${n(r.warningCount, "warning")}`,
      ...(r.unverifiedCount > 0 ? [`Relies on ${n(r.unverifiedCount, "UNVERIFIED rule value")}`] : []),
      ...(r.unsentCount > 0 ? [`${n(r.unsentCount, "required notice")} never sent`] : []),
    ],
    approveEffect: "Records your approval bound to this file's checksum. Nothing is filed.",
    irreversible: IRREVERSIBLE.report,
    unverified: r.unverifiedCount > 0,
    blockers,
    bodyText: null,
    approve:
      blockers.length === 0 && r.checksum
        ? { kind: "report", reportId: r.id, checksum: r.checksum, unverified: r.unverifiedCount, unsent: r.unsentCount }
        : null,
    openHref: href(e.key),
  };
}

function claimRow(e: QueueEntry<QueueKind>): ReviewRow {
  const c = e.claim!;
  return {
    key: e.key,
    kind: "claim",
    title: e.title,
    subtitle: e.subtitle,
    amountCents: e.amountCents,
    state: e.state,
    recipient: [`Replica ${c.state} unclaimed property portal`],
    payload: [`Matched name: ${c.matchedNameVariant ?? "unknown"}`, `Match confidence: ${c.matchConfidence != null ? `${c.matchConfidence}%` : "unknown"}`],
    approveEffect: "Records your approval of this claim as drafted. Nothing is filed.",
    irreversible: IRREVERSIBLE.claim,
    unverified: false,
    blockers: [],
    bodyText: null,
    approve: { kind: "claim", recoveryId: c.id, payloadSha256: c.payloadSha256 },
    openHref: href(e.key),
  };
}

function ruleRow(e: QueueEntry<QueueKind>): ReviewRow {
  const r = e.rule!;
  return {
    key: e.key,
    kind: "rule",
    title: e.title,
    subtitle: e.subtitle,
    amountCents: null,
    state: e.state,
    recipient: [`${r.state} rule file`],
    payload: [`${r.fromVersion ?? "none"} to ${r.toVersion ?? "a new version"}`, `${n(r.sourceCount, "cited source")}`],
    approveEffect: "Rule changes are approved on Rules, side by side with their sources. The law is never decided here.",
    irreversible: IRREVERSIBLE.rule,
    unverified: true,
    blockers: ["Reviewed against its cited sources on Rules."],
    bodyText: null,
    approve: null,
    openHref: href(e.key),
  };
}

export async function loadApprovalsReview(ctx: ChatToolContext): Promise<ApprovalsReviewUi["props"]> {
  const [q, asOf] = await Promise.all([loadQueue(ctx.db, ctx.companyId), today(ctx.db, ctx.companyId)]);
  const waiting = waitingForApproval(q.entries);
  const groups: ReviewGroup[] = [];
  for (const kind of GROUP_ORDER) {
    const all = waiting.filter((e) => e.kind === kind);
    if (all.length === 0) continue;
    const shown = all.slice(0, REVIEW_ROWS_PER_GROUP);
    const rows: ReviewRow[] = [];
    for (const e of shown) {
      if (e.outreach) rows.push(await outreachRow(ctx, e));
      else if (e.report) rows.push(reportRow(e));
      else if (e.claim) rows.push(claimRow(e));
      else if (e.rule) rows.push(ruleRow(e));
    }
    groups.push({ kind, label: GROUP_LABEL[kind], rows, more: all.length - rows.length });
  }
  return { asOf, total: waiting.length, groups };
}

// ---------------------------------------------------------------------------------------------------------------------
// Draft outreach

/** Outreach that counts as "a letter exists" (mirrors LIVE_OUTREACH in src/lib/ask/starter-data.ts). */
const LIVE_OUTREACH = ["draft", "awaiting_approval", "approved", "sent", "delivered", "responded"] as const;

async function resolveItems(ctx: ChatToolContext, query: string): Promise<string[]> {
  const ref = query.trim().replace(/^#/, "");
  if (/^\d{3,}$/.test(ref) || /^[0-9a-f-]{36}$/i.test(ref)) {
    const id = await findStaleItemId(ctx.db, ctx.companyId, ref);
    return id ? [id] : [];
  }
  const like = `%${ref.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const rows = await ctx.db
    .select({ id: staleItems.id })
    .from(staleItems)
    .innerJoin(ledgerItems, eq(ledgerItems.id, staleItems.ledgerItemId))
    .where(and(eq(staleItems.companyId, ctx.companyId), ilike(ledgerItems.payeeNameRaw, like), notInArray(staleItems.status, [...CLOSED_STATUSES])))
    .orderBy(asc(staleItems.ddWindowEnd), asc(ledgerItems.referenceNumber))
    .limit(DRAFT_CANDIDATES);
  return rows.map((r) => r.id);
}

/** Items in an open due-diligence window with no live outreach: the same condition as the Ask "Draft" starter chip. */
async function openWindowItems(ctx: ChatToolContext, asOf: string): Promise<string[]> {
  const rows = await ctx.db
    .select({ id: staleItems.id })
    .from(staleItems)
    .where(
      and(
        eq(staleItems.companyId, ctx.companyId),
        notInArray(staleItems.status, [...CLOSED_STATUSES, "reported"]),
        isNotNull(staleItems.ddWindowStart),
        lte(staleItems.ddWindowStart, asOf),
        or(sql`${staleItems.ddWindowEnd} is null`, gte(staleItems.ddWindowEnd, asOf)),
        notExists(
          ctx.db
            .select({ one: sql`1` })
            .from(outreach)
            .where(and(eq(outreach.staleItemId, staleItems.id), inArray(outreach.status, [...LIVE_OUTREACH]))),
        ),
      ),
    )
    .orderBy(asc(staleItems.ddWindowEnd))
    .limit(DRAFT_CANDIDATES);
  return rows.map((r) => r.id);
}

async function waitingLetters(ctx: ChatToolContext, itemIds: readonly string[] | null): Promise<{ id: string; staleItemId: string; body: string | null }[]> {
  const where = [eq(outreach.companyId, ctx.companyId), eq(outreach.channel, "letter"), inArray(outreach.status, ["draft", "awaiting_approval"])];
  if (itemIds) {
    if (itemIds.length === 0) return [];
    where.push(inArray(outreach.staleItemId, [...itemIds]));
  }
  return ctx.db
    .select({ id: outreach.id, staleItemId: outreach.staleItemId, body: outreach.body })
    .from(outreach)
    .where(and(...where))
    .orderBy(asc(outreach.createdAt))
    .limit(DRAFT_CANDIDATES);
}

async function candidateOf(ctx: ChatToolContext, staleItemId: string, hasDraft: boolean, uncomposed: boolean): Promise<DraftCandidate | null> {
  const [row] = await ctx.db
    .select({ s: staleItems, l: ledgerItems })
    .from(staleItems)
    .innerJoin(ledgerItems, eq(ledgerItems.id, staleItems.ledgerItemId))
    .where(and(eq(staleItems.id, staleItemId), eq(staleItems.companyId, ctx.companyId)));
  if (!row) return null;
  const plan = hasDraft ? undefined : await checkDraftEligibility(ctx.db, staleItemId, "letter");
  // The same refusal the draft route enforces (assertDraftable); other skip codes are advisory and still draft.
  const refused = plan?.decision === "skip" && REFUSING_CODES.includes(plan.code);
  return {
    staleItemId,
    checkNumber: row.l.referenceNumber,
    payeeName: row.l.payeeNameRaw,
    state: row.s.ownerState,
    amountCents: row.s.amountCents,
    windowEnd: row.s.ddWindowEnd,
    unverified: row.s.dependsOnUnverified,
    decision: !hasDraft && !refused ? "draft" : "skip",
    reason: hasDraft
      ? "A letter is already drafted and waits for approval."
      : plan?.decision === "skip"
        ? plan.message
        : uncomposed
          ? "A draft exists but has no letter text yet. Request approval composes it from the rule file."
          : null,
    hasDraft,
  };
}

export async function loadOutreachDrafts(ctx: ChatToolContext, query: string | null): Promise<OutreachDraftsUi["props"]> {
  const asOf = await today(ctx.db, ctx.companyId);
  const named = query ? await resolveItems(ctx, query) : null;
  if (named && named.length === 0) return { asOf, query, drafts: [], candidates: [], notFound: `No open item matches "${query}".` };
  const letters = await waitingLetters(ctx, named);
  // A composed letter is previewed (and approvable); an uncomposed draft is offered for composing like a new item.
  const composed = letters.filter((l) => l.body !== null && l.body.trim() !== "").slice(0, DRAFT_PREVIEWS);
  const uncomposed = new Set(letters.filter((l) => !composed.includes(l)).map((l) => l.staleItemId));
  const drafts = await Promise.all(composed.map((l) => approvalCard(ctx, l.id, false)));
  const drafted = new Set(composed.map((l) => l.staleItemId));
  const ids = [...new Set([...(named ?? (await openWindowItems(ctx, asOf))), ...uncomposed])].slice(0, DRAFT_CANDIDATES);
  const candidates = (await Promise.all(ids.map((id) => candidateOf(ctx, id, drafted.has(id), uncomposed.has(id))))).filter(
    (c): c is DraftCandidate => c !== null,
  );
  return { asOf, query, drafts, candidates, notFound: null };
}

// ---------------------------------------------------------------------------------------------------------------------
// Close a month

const MONTH_NAMES = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/**
 * The month a request means, against the demo clock (never in the intent regex): a named month without a year is its
 * latest occurrence on or before the demo month; "the month" is the latest month that has ended and is still open,
 * else the demo month. Returns null for a month name it does not know.
 */
export function resolveCloseMonth(
  input: { month?: string; year?: number },
  todayIso: string,
  open: readonly string[],
): string | null {
  const ym = todayIso.slice(0, 7);
  if (!input.month) {
    const ended = open.filter((m) => m < ym).sort().reverse()[0];
    return ended ?? ym;
  }
  const idx = MONTH_NAMES.findIndex((m) => m.startsWith(input.month!.toLowerCase().slice(0, 3)));
  if (idx < 0) return null;
  const mm = String(idx + 1).padStart(2, "0");
  if (input.year) return `${input.year}-${mm}`;
  const y = Number(ym.slice(0, 4));
  return `${ym.slice(5, 7) >= mm ? y : y - 1}-${mm}`;
}

function unverifiedRulesOf(state: string): { hasRules: boolean; count: number } {
  const r = tryLoadRules(state);
  return r ? { hasRules: true, count: listRuleValues(r.file).filter((v) => !v.rv.verified).length } : { hasRules: false, count: 0 };
}

const tieLine = (r: Roll): TieStateLine => {
  const rules = r.state === "Total" ? { hasRules: true, count: 0 } : unverifiedRulesOf(r.state);
  return { state: r.state, openingCents: r.opening, closingCents: r.closing, reconciles: r.reconciles, unverifiedRules: rules.count, hasRules: rules.hasRules };
};

/** Movements dated in or before `period` that arrived after its close and posted to an open month (R11-01). */
function lateActivityOf(movements: readonly Movement[], period: string): { count: number; cents: number; postedIn: string } | null {
  const late = movements.filter((m) => m.priorPeriodOf !== undefined && m.priorPeriodOf <= period && m.date.slice(0, 7) > period);
  const adj = adjustmentOf(late);
  return adj ? { count: adj.count, cents: adj.cents, postedIn: adj.postedIn } : null;
}

export async function loadPeriodClose(ctx: ChatToolContext, input: { period?: string; month?: string; year?: number }): Promise<PeriodCloseUi["props"]> {
  const data = await loadLedger(ctx.db, ctx.companyId);
  const movements = ledgerMovements(data);
  const months = monthsWithActivity(movements, data.today);
  const closedRows = await listClosedPeriods(ctx.db, ctx.companyId);
  const closedPeriods = closedRows.map((c) => c.period);
  const closedSet = new Set(closedPeriods);
  const open = months.filter((m) => !closedSet.has(m));
  // R11-04: after the first close, "the month" is the next closable month; only it is offered as a chip.
  const nextClosable = nextClosableMonth(closedPeriods, months);
  const asked = input.period && isMonthId(input.period) ? input.period : !input.month && nextClosable ? nextClosable : resolveCloseMonth(input, data.today, open);
  const period = asked;
  if (!period) throw new Error("unknown month");
  const label = monthLabel(period);
  const offered = closedPeriods.length > 0 ? (nextClosable ? [nextClosable] : []) : open;
  const otherOpen = offered.filter((m) => m !== period).slice(0, 3).map((m) => ({ period: m, label: monthLabel(m) }));
  const closed = closedRows.find((c) => c.period === period) ?? null;
  const p = monthPeriod(period, data.today);
  const base = { asOf: data.today, period, label, otherOpen, blocked: null, adjustment: null, lateActivity: null };
  if (!p.ok && !closed) {
    return { ...base, status: "not_started", preview: null, tieOut: null, closed: null };
  }
  if (closed) {
    // R11-01: a closed month shows what was frozen at close. Live totals are only the fallback for a close recorded
    // before the snapshot existed.
    const frozen = closed.frozen;
    const live = !frozen && p.ok ? computeLedger(data, "month", p.period).roll : null;
    const src = frozen ? { states: frozen.states, total: frozen.total, allTie: frozen.allTie } : live ? { states: live.states, total: live.total, allTie: live.total.reconciles && live.states.every((s) => s.reconciles) } : null;
    return {
      ...base,
      status: "closed",
      preview: null,
      tieOut: src ? { allTie: src.allTie, total: tieLine({ ...src.total, state: "Total" }), states: src.states.map(tieLine) } : null,
      closed: { manifestSha256: closed.manifestSha256, chainSeq: closed.chainSeq, closedBy: closed.closedBy, demoDate: closed.demoDate, frozen: frozen !== null },
      lateActivity: lateActivityOf(movements, period),
    };
  }
  const view = p.ok ? computeLedger(data, "month", p.period) : null;
  const tieOut = view
    ? { allTie: view.roll.total.reconciles && view.roll.states.every((s) => s.reconciles), total: tieLine({ ...view.roll.total, state: "Total" }), states: view.roll.states.map(tieLine) }
    : null;
  const pv = closePreviews(data, [period])[period];
  const adj = view?.roll.adjustment ?? null;
  return {
    ...base,
    status: pv ? "open" : "not_started",
    preview: pv ? { entryCount: pv.entryCount, journalSha256: pv.journalSha256, closingCents: pv.closingCents, notOver: pv.notOver, coversThrough: pv.coversThrough } : null,
    tieOut,
    closed: null,
    blocked: pv?.blocked ?? null,
    adjustment: adj ? { count: adj.count, cents: adj.cents, months: adj.months } : null,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// File a state report

const UNAPPROVED_REPORT = new Set(["validated", "awaiting_approval"]);

export async function loadFiling(ctx: ChatToolContext, state: string): Promise<FilingCardUi["props"]> {
  const snap = await loadCloseSnapshot(ctx.db, ctx.companyId, state);
  const reportRow = snap.report ? (await ctx.db.select().from(reports).where(eq(reports.id, snap.report.id)))[0] ?? null : null;
  let report: FilingCardUi["props"]["report"] = null;
  if (reportRow) {
    const errs = (reportRow.validationErrors ?? []) as { severity?: string }[];
    const errorCount = errs.filter((e) => e.severity === "error").length;
    const unapproved = UNAPPROVED_REPORT.has(reportRow.status);
    const acks = unapproved ? await approvalAcknowledgements(ctx.db, ctx.companyId, reportRow.state, reportRow) : null;
    report = {
      status: reportRow.status,
      stage: reportRow.stage,
      itemCount: reportRow.itemCount,
      totalCents: reportRow.totalCents,
      errorCount,
      warningCount: errs.filter((e) => e.severity === "warning").length,
      confirmation: reportRow.replicaConfirmation ?? null,
      approve:
        acks && errorCount === 0 && reportRow.checksum
          ? { kind: "report", reportId: reportRow.id, checksum: reportRow.checksum, unverified: acks.unverified, unsent: acks.unsent }
          : null,
    };
  }
  return {
    asOf: snap.asOf,
    state: snap.state,
    hasRules: snap.hasRules,
    ruleVersion: snap.ruleVersion,
    unverifiedRules: snap.unverifiedRulePaths.length,
    toReport: snap.toReport,
    report,
    filingRun: snap.filingRun ? { status: snap.filingRun.status, phase: snap.filingRun.phase } : null,
    runnerHref: `/close-out/${snap.state}`,
    reportsHref: `/reports?state=${snap.state}`,
  };
}
