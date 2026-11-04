/**
 * Generative-UI payloads: what a chat tool hands the CLIENT to render (the model never sees these).
 * Every payload is plain JSON. `kind` selects a component in src/components/chat/views.
 */
import type { DeadlineEvent, Exposure, Explanation, InterestExposure, StaleItemRow } from "@/lib/queries/schemas";

export interface ExposureUi {
  kind: "exposure";
  props: { exposure: Exposure; state: string | null };
}

export interface ItemsUi {
  kind: "items";
  props: { asOf: string; total: number; items: StaleItemRow[]; filters: Record<string, string | number | boolean> };
}

export interface ItemTimelineUi {
  kind: "item_timeline";
  props: { explanation: Explanation };
}

export interface DeadlinesUi {
  kind: "deadlines";
  props: { asOf: string; days: number; events: DeadlineEvent[] };
}

export interface ForecastUiMonth {
  /** YYYY-MM */
  month: string;
  presumedCents: number;
  presumedCount: number;
  remitCents: number;
  remitCount: number;
  ddOpenCount: number;
  reportDueCount: number;
  anyUnverified: boolean;
  byState: { state: string; presumedCents: number; remitCents: number; unverified: boolean }[];
}

export interface ForecastUi {
  kind: "forecast";
  props: {
    asOf: string;
    horizonMonths: number;
    state: string | null;
    states: string[];
    months: ForecastUiMonth[];
    totals: { presumedCents: number; presumedCount: number; remitCents: number; remitCount: number; events: number; unverifiedEvents: number };
    unknown: { count: number; cents: number; items: { itemId: string; checkNumber: string | null; payeeName: string; state: string | null; amountCents: number; missing: string[] }[] };
  };
}

export interface InterestUi {
  kind: "interest";
  props: { interest: InterestExposure };
}

export interface PendingApproval {
  key: string;
  kind: "letter" | "email" | "voice" | "report" | "claim" | "rule";
  title: string;
  subtitle: string;
  amountCents: number | null;
  state: string | null;
  status: string;
  href: string;
}

export interface ApprovalsUi {
  kind: "approvals";
  props: { entries: PendingApproval[] };
}

export interface ApprovalCardUi {
  kind: "approval_card";
  props: {
    outreachId: string;
    channel: "letter" | "email" | "voice";
    status: string;
    created: boolean;
    itemId: string;
    checkNumber: string | null;
    ownerName: string;
    ownerAddress: string;
    amountFormatted: string;
    subject: string | null;
    /** Plain text of what will be sent (letters are previewed via the sandboxed preview route). */
    bodyText: string | null;
    /** True when bodyText is cut short; the card then never offers an inline approval. */
    bodyTruncated: boolean;
    /** Letters: every stored address field, one line each, starting with the recipient name as it will print. */
    toAddressLines: string[];
    /** Everything the approval hash covers is shown on the card. Inline "Approve as me" requires this. */
    fullyShown: boolean;
    readiness: { ready: boolean; problems: string[]; warnings: string[] };
    requiredLanguageVerified: boolean | null;
    /** Hash of exactly this content; the human's Approve click sends it back (stale content is refused). */
    contentSha256: string;
    previewUrl: string;
    reviewUrl: string;
  };
}

export interface RuleStateSummary {
  state: string;
  version: string;
  total: number;
  verified: number;
  unknown: number;
  unverifiedPaths: { path: string; todo: string | null; hasValue: boolean }[];
}

export interface RulesUi {
  kind: "rules";
  props: { states: RuleStateSummary[] };
}

export interface ReportSummaryUi {
  state: string;
  ruleVersion: string | null;
  ruleUnverifiedCount: number;
  toReportCount: number;
  toReportCents: number;
  latest: { id: string; status: string; itemCount: number; totalCents: number; createdAt: string } | null;
}

export interface ReportsUi {
  kind: "reports";
  props: { states: ReportSummaryUi[] };
}

export interface ReportUi {
  kind: "report";
  props: {
    reportId: string;
    state: string;
    status: string;
    itemCount: number;
    totalCents: number;
    checksum: string | null;
    stage: string | null;
    errors: { field?: string; message: string; severity: string }[];
    warnings: string[];
    excludedCount: number;
    /** Set when chat refused to regenerate because a person already holds this report (awaiting approval or approved). */
    heldForReview: { notice: string; href: string; linkLabel: string } | null;
  };
}

export interface RecoveryRow {
  id: string;
  state: string;
  amountCents: number;
  holderNameFound: string | null;
  matchedNameVariant: string | null;
  matchConfidence: number | null;
  status: string;
  approvedBy: string | null;
}

export interface RecoveriesUi {
  kind: "recoveries";
  props: { recoveries: RecoveryRow[] };
}

export interface RunRow {
  id: string;
  agent: string;
  model: string | null;
  status: string;
  startedAt: string;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsdMicros: number | null;
  error: string | null;
}

export interface RunsUi {
  kind: "runs";
  props: { runs: RunRow[] };
}

export interface AgentRunUi {
  kind: "agent_run";
  props: { runId: string; agent: string; title: string; live: boolean };
}

export interface ClockUi {
  kind: "clock";
  props: {
    today: string;
    offsetDays: number;
    canAdvance: boolean;
    /** advance_clock's proposal. Nothing moved yet: the person applies it with the card's button (POST /api/clock). */
    proposal: null | { days: number; to: string };
  };
}

export interface LinkUi {
  kind: "link";
  props: { href: string; title: string; description: string };
}

/** done; ready (the card can run it); running (an agent is working on it); needs_approval (a person acts at a gate); blocked (with a reason). */
export type CloseStepStatus = "done" | "ready" | "running" | "needs_approval" | "blocked";

export type CloseStepId =
  | "letters_draft"
  | "letters_approve"
  | "letters_send"
  | "rules_verify"
  | "report_generate"
  | "report_approve"
  | "report_submit"
  | "remit";

/** What the card may run itself. Only reversible, approval-free work; never approve, send, submit or pay. */
export type CloseStepActionKind = "draft_letters" | "generate_report";

export interface CloseStep {
  id: CloseStepId;
  title: string;
  status: CloseStepStatus;
  /** What is true right now, in one plain sentence. */
  detail: string;
  /** Set only when status is "blocked". */
  blockedReason: string | null;
  /** Money this step covers (cents), or null when it covers no money. */
  amountCents: number | null;
  /** Items this step covers, or null. */
  count: number | null;
  /** Where the person acts (an in-app gate or page). */
  href: string;
  linkLabel: string;
  /** A safe step the card can run with one click (drafts or a validated file; nothing leaves the app). */
  action: { kind: CloseStepActionKind; label: string } | null;
  /** The money or dates of this step depend on an UNVERIFIED rule value. */
  unverified: boolean;
  /** R6-04: the close-out runner skips this step this cycle (e.g. no letter is due). Set only on chat's card. */
  notNeeded?: boolean;
}

export interface ClosePlan {
  state: string;
  stateName: string;
  /** Demo-clock date the plan was built for (YYYY-MM-DD). */
  asOf: string;
  ruleVersion: string | null;
  steps: CloseStep[];
  /** Steps done. On chat's card these are the runner's counts: not-needed steps are neither done nor counted (R6-04). */
  done: number;
  total: number;
  /** Steps the runner marks not needed this cycle (chat's card only). */
  notNeeded?: number;
  /** First step that is ready or needs approval: the one the card fills blue. */
  nextStepId: CloseStepId | null;
  /** Every item in this cycle (cents) and how many. */
  atStakeCents: number;
  itemCount: number;
  /** Earliest report due date among the cycle's items, from the rules engine (null = none or UNKNOWN). */
  reportDue: { date: string | null; unverified: boolean } | null;
  /** Earliest remittance due date among the cycle's items, from the rules engine. */
  remitDue: { date: string | null; unverified: boolean } | null;
}

export interface ClosePlanUi {
  kind: "close_plan";
  props: { plan: ClosePlan };
}

export interface ErrorUi {
  kind: "error";
  /**
   * `refused`: the app declined on purpose (a rule said no, e.g. a due-diligence window that is not open). That is the
   * system working, not a failure, and nobody has to act, so it renders neutral rather than pink.
   */
  props: { message: string; refused?: boolean };
}

export type UiPayload =
  | ExposureUi
  | ItemsUi
  | ItemTimelineUi
  | DeadlinesUi
  | ForecastUi
  | InterestUi
  | ApprovalsUi
  | ApprovalCardUi
  | RulesUi
  | ReportsUi
  | ReportUi
  | RecoveriesUi
  | RunsUi
  | AgentRunUi
  | ClockUi
  | LinkUi
  | ClosePlanUi
  | ErrorUi;

export type UiKind = UiPayload["kind"];
