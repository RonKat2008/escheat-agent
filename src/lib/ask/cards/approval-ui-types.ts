/**
 * The `ui` contract for the Ask approval-class cards (docs/ASK-MODE.md slice 4): review approvals, draft outreach,
 * close a month, file a state report. Ids and hashes live here only (the client needs them to call the EXISTING approval
 * endpoints with the hash the person saw); they never appear in a tool's model `data`.
 *
 * Pure types; client-safe.
 */
import type { ApprovalCardUi } from "@/lib/chat/ui-types";

/**
 * What an Approve click sends, and to which existing endpoint (see ./approval-request.ts). Each variant carries exactly
 * the server-issued hash the Approvals page sends for the same row.
 */
export type CardApproval =
  | { kind: "outreach"; outreachId: string; contentSha256: string }
  | { kind: "report"; reportId: string; checksum: string; unverified: number; unsent: number }
  | { kind: "claim"; recoveryId: string; payloadSha256: string };

export type ReviewKind = "letter" | "email" | "voice" | "report" | "claim" | "rule";

export interface ReviewRow {
  /** The Approvals queue key ("o:<id>", "r:<id>", ...); the Open link selects it there. */
  key: string;
  kind: ReviewKind;
  title: string;
  subtitle: string;
  amountCents: number | null;
  state: string | null;
  /** Who or where it goes: the letter's address lines, a masked email/phone label, or the replica state portal. */
  recipient: string[];
  /** The payload the approval binds to, in plain words (one fact per line). */
  payload: string[];
  /** What the Approve click records. */
  approveEffect: string;
  /** The irreversible step that can follow later, and where it happens. */
  irreversible: string;
  /** The approval rests on rule values nobody has verified (UNVERIFIED badge). */
  unverified: boolean;
  /** Why this row cannot be approved here (it still opens in Approvals). Empty when it can. */
  blockers: string[];
  /** Letter text exactly as it will print, when the card can show all of it. */
  bodyText: string | null;
  /** Null when this row is approved on its own page (recipient choice, rules, blockers). */
  approve: CardApproval | null;
  /** A letter with no text yet (R11-06): "Compose" drafts it through the existing draft route. Never approves or sends. */
  compose: { staleItemId: string } | null;
  /** Approvals page, with this row selected (decline, edit, or approve there). */
  openHref: string;
}

export interface ReviewGroup {
  kind: ReviewKind;
  /** "Mail letters", "Submit reports", ... */
  label: string;
  rows: ReviewRow[];
  /** Rows of this kind beyond the ones shown. */
  more: number;
}

export interface ApprovalsReviewUi {
  kind: "approvals_review";
  props: {
    asOf: string;
    /** Everything that waits for a person, the same count as the Ask chip (summarizeWaiting). */
    total: number;
    /** Of `total`, letters that still need composing before anyone can approve them. */
    toCompose: number;
    groups: ReviewGroup[];
  };
}

export interface DraftCandidate {
  staleItemId: string;
  checkNumber: string | null;
  payeeName: string;
  state: string | null;
  amountCents: number;
  /** Rules-engine due-diligence window close, if one was computed. */
  windowEnd: string | null;
  unverified: boolean;
  /** "draft": Request approval drafts it now. "skip": `reason` says why (from the shared eligibility check). */
  decision: "draft" | "skip";
  reason: string | null;
  /** A letter for this item already waits for approval (shown in `drafts`). */
  hasDraft: boolean;
  /** A draft row exists but has no letter text yet: the button composes it (R11-06). */
  uncomposed: boolean;
}

export interface OutreachDraftsUi {
  kind: "outreach_drafts";
  props: {
    asOf: string;
    /** What the person asked for ("#10087", "Ravenhill"); null for "draft letters". */
    query: string | null;
    /** Letters already drafted and waiting: the same preview and inline approval as the chat approval card. */
    drafts: ApprovalCardUi["props"][];
    candidates: DraftCandidate[];
    /** Set when `query` matched nothing. */
    notFound: string | null;
  };
}

export interface TieStateLine {
  state: string;
  openingCents: number;
  closingCents: number;
  reconciles: boolean;
  /** UNVERIFIED rule values in this state's rule file (0 for a state with no rule file). */
  unverifiedRules: number;
  hasRules: boolean;
}

export interface PeriodCloseUi {
  kind: "period_close";
  props: {
    asOf: string;
    period: string;
    label: string;
    status: "open" | "closed" | "not_started";
    /** Open months only: what closing freezes; the server re-checks journalSha256 on close. */
    preview: { entryCount: number; journalSha256: string; closingCents: number; notOver: boolean; coversThrough: string } | null;
    /** For a closed month: the figures FROZEN at close (R11-01), never live totals. */
    tieOut: { allTie: boolean; total: TieStateLine; states: TieStateLine[] } | null;
    /** `frozen` is false only for a close recorded before its figures were stored (then tieOut is live). */
    closed: { manifestSha256: string; chainSeq: number; closedBy: string; demoDate: string; frozen: boolean } | null;
    /** R11-04: why this open month cannot be closed yet (months close in order), or null. */
    blocked: string | null;
    /** Open month: the prior-period adjustment posted in it (late activity dated in closed books), or null. */
    adjustment: { count: number; cents: number; months: string[] } | null;
    /** Closed month: activity dated in or before it that arrived after the close, and the open month it posted to. */
    lateActivity: { count: number; cents: number; postedIn: string } | null;
    /** Other months with activity that are still open (chips that ask for their own close card). */
    otherOpen: { period: string; label: string }[];
  };
}

export interface FilingCardUi {
  kind: "filing";
  props: {
    asOf: string;
    state: string;
    hasRules: boolean;
    ruleVersion: string | null;
    /** UNVERIFIED rule values this cycle relies on (the count an approval must acknowledge). */
    unverifiedRules: number;
    /** UNVERIFIED values anywhere in this state's rule file, whatever the item count (R11-08). Drives the badge. */
    ruleFileUnverified: number;
    toReport: { count: number; cents: number };
    report: {
      status: string;
      stage: string | null;
      itemCount: number;
      totalCents: number;
      errorCount: number;
      warningCount: number;
      confirmation: string | null;
      /** Inline approval (unapproved, no validation errors, checksum present); null otherwise. */
      approve: Extract<CardApproval, { kind: "report" }> | null;
    } | null;
    filingRun: { status: string; phase: string | null } | null;
    /** The existing replica filing flow: the close-out runner and the Reports page. */
    runnerHref: string;
    reportsHref: string;
  };
}

export type AskApprovalUi = ApprovalsReviewUi | OutreachDraftsUi | PeriodCloseUi | FilingCardUi;
