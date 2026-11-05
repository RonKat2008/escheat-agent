import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/* ------------------------------------------------------------------ enums */

export const propertyTypeEnum = pgEnum("property_type", [
  "vendor_check",
  "payroll_check",
  "customer_credit",
  "unapplied_cash",
]);

export const ledgerStatusEnum = pgEnum("ledger_status", [
  "outstanding",
  "cleared",
  "voided",
  "reissued",
]);

export const ledgerSourceEnum = pgEnum("ledger_source", ["csv", "qbo", "synthetic"]);

export const clearSourceEnum = pgEnum("clear_source", ["csv", "plaid", "synthetic"]);

export const mergeBasisEnum = pgEnum("merge_basis", ["exact", "rule", "model", "human"]);

export const staleStatusEnum = pgEnum("stale_status", [
  "watching",
  "dd_pending",
  "dd_sent",
  "owner_responded",
  "resolved_paid",
  "to_report",
  "reported",
  "remitted",
  "needs_rule",
]);

export const ownerStateBasisEnum = pgEnum("owner_state_basis", ["address", "incorporation"]);

export const outreachChannelEnum = pgEnum("outreach_channel", ["letter", "email", "voice"]);

export const outreachStatusEnum = pgEnum("outreach_status", [
  "draft",
  "awaiting_approval",
  "approved",
  "sent",
  "delivered",
  "failed",
  "responded",
  "cancelled",
]);

export const reportStatusEnum = pgEnum("report_status", [
  "draft",
  "validated",
  "awaiting_approval",
  "approved",
  "submitted",
  "confirmed",
  "failed",
]);

export const recoveryStatusEnum = pgEnum("recovery_status", [
  "found",
  "claim_drafted",
  "awaiting_approval",
  "claim_submitted",
  "paid",
  "rejected",
]);

export const approvalActionEnum = pgEnum("approval_action", [
  "mail_letter",
  "send_email",
  "place_call",
  "submit_report",
  "file_claim",
  "apply_rule_change",
  "mark_resolved_paid",
  "discard_draft",
  "close_period",
]);

export const agentRunStatusEnum = pgEnum("agent_run_status", [
  "running",
  "succeeded",
  "failed",
  "cancelled",
]);

export const ruleChangeStatusEnum = pgEnum("rule_change_status", [
  "proposed",
  "approved",
  "rejected",
  "applied",
]);

export const evalSliceEnum = pgEnum("eval_slice", ["generated", "adversarial"]);

/* ----------------------------------------------------------------- helpers */

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
/** Money is integer cents, held in bigint (number mode). */
const cents = (name: string) => bigint(name, { mode: "number" });

/* ------------------------------------------------------------------ tables */

export const companies = pgTable("companies", {
  id: id(),
  name: text("name").notNull(),
  incorporationState: text("incorporation_state").notNull(),
  hqState: text("hq_state"),
  addressLine: text("address_line"),
  city: text("city"),
  zip: text("zip"),
  fein: text("fein"),
  fiscalYearEnd: text("fiscal_year_end").notNull().default("12-31"), // MM-DD
  isSynthetic: boolean("is_synthetic").notNull().default(true),
  createdAt: createdAt(),
});

export const payees = pgTable(
  "payees",
  {
    id: id(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    canonicalName: text("canonical_name").notNull(),
    aliases: text("aliases")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    addressLine: text("address_line"),
    city: text("city"),
    state: text("state"),
    zip: text("zip"),
    mergeBasis: mergeBasisEnum("merge_basis").notNull().default("exact"),
    mergeConfidence: integer("merge_confidence"), // 0..100
    /** Human review trail (merge / split / rename from /payees). Null until a person has changed this payee. */
    reviewedBy: text("reviewed_by"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewAction: text("review_action"), // 'merge' | 'split' | 'rename'
    createdAt: createdAt(),
  },
  (t) => [index("payees_company_idx").on(t.companyId), index("payees_state_idx").on(t.state)],
);

export const ledgerItems = pgTable(
  "ledger_items",
  {
    id: id(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    payeeId: uuid("payee_id").references(() => payees.id, { onDelete: "set null" }),
    payeeNameRaw: text("payee_name_raw").notNull(),
    propertyType: propertyTypeEnum("property_type").notNull(),
    referenceNumber: text("reference_number"), // check number / credit memo id
    amountCents: cents("amount_cents").notNull(),
    issueDate: date("issue_date", { mode: "string" }).notNull(),
    lastActivityDate: date("last_activity_date", { mode: "string" }),
    status: ledgerStatusEnum("status").notNull().default("outstanding"),
    addressLine: text("address_line"),
    city: text("city"),
    state: text("state"),
    zip: text("zip"),
    memo: text("memo"),
    rawRow: jsonb("raw_row").$type<Record<string, unknown>>(),
    source: ledgerSourceEnum("source").notNull().default("csv"),
    createdAt: createdAt(),
  },
  (t) => [
    index("ledger_items_company_idx").on(t.companyId),
    index("ledger_items_payee_idx").on(t.payeeId),
    index("ledger_items_status_idx").on(t.status),
  ],
);

export const bankClears = pgTable(
  "bank_clears",
  {
    id: id(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    ledgerItemId: uuid("ledger_item_id").references(() => ledgerItems.id, { onDelete: "set null" }),
    referenceNumber: text("reference_number"),
    amountCents: cents("amount_cents").notNull(),
    clearedDate: date("cleared_date", { mode: "string" }).notNull(),
    description: text("description"),
    source: clearSourceEnum("source").notNull().default("csv"),
    createdAt: createdAt(),
  },
  (t) => [
    index("bank_clears_company_idx").on(t.companyId),
    index("bank_clears_ledger_item_idx").on(t.ledgerItemId),
  ],
);

export const staleItems = pgTable(
  "stale_items",
  {
    id: id(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    ledgerItemId: uuid("ledger_item_id")
      .notNull()
      .references(() => ledgerItems.id, { onDelete: "cascade" }),
    ownerPayeeId: uuid("owner_payee_id").references(() => payees.id, { onDelete: "set null" }),
    amountCents: cents("amount_cents").notNull(), // snapshot
    propertyType: propertyTypeEnum("property_type").notNull(),
    ownerState: text("owner_state"),
    ownerStateBasis: ownerStateBasisEnum("owner_state_basis"),
    propertyCode: text("property_code"), // NAUPA code from the rule file, never model-chosen
    lastActivityDate: date("last_activity_date", { mode: "string" }),
    classificationConfidence: integer("classification_confidence"), // 0..100
    needsReview: boolean("needs_review").notNull().default(false),
    status: staleStatusEnum("status").notNull().default("watching"),
    staleSince: date("stale_since", { mode: "string" }).notNull(),
    // Legal dates: nullable. Null means the rule is missing (UNKNOWN), never a guess.
    presumedAbandonedDate: date("presumed_abandoned_date", { mode: "string" }),
    ddWindowStart: date("dd_window_start", { mode: "string" }),
    ddWindowEnd: date("dd_window_end", { mode: "string" }),
    reportDueDate: date("report_due_date", { mode: "string" }),
    remitDueDate: date("remit_due_date", { mode: "string" }),
    reportStage: text("report_stage"), // e.g. CA notice vs remit stage
    ruleVersion: text("rule_version"),
    dependsOnUnverified: boolean("depends_on_unverified").notNull().default(false),
    classification: jsonb("classification").$type<Record<string, unknown>>(),
    inngestRunId: text("inngest_run_id"),
    deadlineMovedAt: timestamp("deadline_moved_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("stale_items_company_idx").on(t.companyId),
    uniqueIndex("stale_items_ledger_item_uq").on(t.ledgerItemId),
    index("stale_items_status_idx").on(t.status),
    index("stale_items_owner_state_idx").on(t.ownerState),
  ],
);

export const stateRules = pgTable(
  "state_rules",
  {
    id: id(),
    state: text("state").notNull(),
    version: text("version").notNull(),
    propertyType: propertyTypeEnum("property_type").notNull(),
    dormancyMonths: integer("dormancy_months"),
    ddWindowDaysMin: integer("dd_window_days_min"),
    ddWindowDaysMax: integer("dd_window_days_max"),
    minReportableCents: cents("min_reportable_cents"),
    ruleJson: jsonb("rule_json").$type<Record<string, unknown>>().notNull(),
    fieldSources: jsonb("field_sources").$type<Record<string, unknown>>(),
    reportStages: jsonb("report_stages").$type<unknown[]>(),
    interestRule: jsonb("interest_rule").$type<Record<string, unknown>>(),
    sourceUrls: text("source_urls")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    verified: boolean("verified").notNull().default(false),
    ruleFileSha: text("rule_file_sha"),
    effectiveFrom: date("effective_from", { mode: "string" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("state_rules_state_version_type_uq").on(t.state, t.version, t.propertyType)],
);

export const ruleChanges = pgTable(
  "rule_changes",
  {
    id: id(),
    state: text("state").notNull(),
    fromVersion: text("from_version"),
    toVersion: text("to_version"),
    diff: jsonb("diff").$type<Record<string, unknown>>().notNull(),
    sourceUrls: text("source_urls")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    status: ruleChangeStatusEnum("status").notNull().default("proposed"),
    reviewedBy: text("reviewed_by"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("rule_changes_state_idx").on(t.state), index("rule_changes_status_idx").on(t.status)],
);

/**
 * R4-02: human rule approvals and adoptions are app data, never edits to the checked-in rules/*.json. Each row is one
 * approval applied on top of the reviewed baseline file whose sha256 is `baseSha256`; the rule loader overlays the rows
 * in order (src/lib/rules/overlay.ts), and each row is one new rule version (`version`).
 */
export const ruleApprovals = pgTable(
  "rule_approvals",
  {
    id: id(),
    state: text("state").notNull(),
    /** "verify" marks existing values verified; "adopt" sets a value from its cited source (plus owner-facing text). */
    kind: text("kind").$type<"verify" | "adopt">().notNull(),
    baseVersion: text("base_version").notNull(),
    baseSha256: text("base_sha256").notNull(),
    /** The rule version this approval produces (`<baseVersion>+appr.<stamp>`). */
    version: text("version").notNull(),
    fieldPaths: jsonb("field_paths").$type<string[]>().notNull(),
    /** adopt: the verbatim value taken from the source. */
    value: jsonb("value").$type<unknown>(),
    /** adopt of notice language: the owner-facing sentence a human wrote and approved. */
    ownerText: text("owner_text"),
    sources: jsonb("sources").$type<unknown[]>().notNull().default(sql`'[]'::jsonb`),
    note: text("note"),
    approvedBy: text("approved_by").notNull(),
    approvedAt: timestamp("approved_at", { withTimezone: true }).notNull(),
    approvalId: uuid("approval_id"),
    /** Set when a person withdraws the approval (kept for the audit trail; the overlay skips it). */
    withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
    withdrawnBy: text("withdrawn_by"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("rule_approvals_state_version_uq").on(t.state, t.version), index("rule_approvals_state_idx").on(t.state)],
);

export const approvals = pgTable(
  "approvals",
  {
    id: id(),
    action: approvalActionEnum("action").notNull(),
    subjectId: text("subject_id").notNull(),
    payloadSha256: text("payload_sha256").notNull(),
    approvedBy: text("approved_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    /** Why a person decided this way. Set for discard_draft rows (a human rejection); null for ordinary approvals. */
    reason: text("reason"),
    createdAt: createdAt(),
  },
  (t) => [index("approvals_subject_idx").on(t.action, t.subjectId)],
);

export const outreach = pgTable(
  "outreach",
  {
    id: id(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    staleItemId: uuid("stale_item_id")
      .notNull()
      .references(() => staleItems.id, { onDelete: "cascade" }),
    approvalId: uuid("approval_id").references(() => approvals.id, { onDelete: "set null" }),
    channel: outreachChannelEnum("channel").notNull(),
    status: outreachStatusEnum("status").notNull().default("draft"),
    toAddress: text("to_address"),
    subject: text("subject"),
    body: text("body"),
    providerId: text("provider_id"),
    tokenHash: text("token_hash"),
    previewUrl: text("preview_url"),
    tracking: jsonb("tracking").$type<Record<string, unknown>>(),
    offline: boolean("offline").notNull().default(false),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("outreach_company_idx").on(t.companyId),
    index("outreach_stale_item_idx").on(t.staleItemId),
    index("outreach_status_idx").on(t.status),
  ],
);

/**
 * One notice per owner: every stale item a letter covers. `outreach.stale_item_id` stays the lead item (single-item
 * letters keep working with no rows here); a consolidated letter lists each of its items once, in letter order.
 * `amount_cents` is the snapshot printed in the letter; the approval payload is rebuilt from the live items, so a
 * changed or added item voids the approval.
 */
export const outreachItems = pgTable(
  "outreach_items",
  {
    id: id(),
    outreachId: uuid("outreach_id")
      .notNull()
      .references(() => outreach.id, { onDelete: "cascade" }),
    staleItemId: uuid("stale_item_id")
      .notNull()
      .references(() => staleItems.id, { onDelete: "cascade" }),
    amountCents: cents("amount_cents").notNull(),
    position: integer("position").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("outreach_items_outreach_item_uq").on(t.outreachId, t.staleItemId),
    index("outreach_items_stale_item_idx").on(t.staleItemId),
  ],
);

/** Claim table for webhook dedupe (review L6): the unique key makes "first delivery wins" atomic under concurrency. */
export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: id(),
    source: text("source").notNull(),
    eventId: text("event_id").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("webhook_events_source_event_uq").on(t.source, t.eventId)],
);

export const reports = pgTable(
  "reports",
  {
    id: id(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    state: text("state").notNull(),
    reportYear: integer("report_year").notNull(),
    format: text("format").notNull().default("naupa"),
    stage: text("stage"),
    status: reportStatusEnum("status").notNull().default("draft"),
    totalCents: cents("total_cents").notNull().default(0),
    itemCount: integer("item_count").notNull().default(0),
    checksum: text("checksum"),
    filePath: text("file_path"),
    validationErrors: jsonb("validation_errors").$type<unknown[]>(),
    approvalId: uuid("approval_id").references(() => approvals.id, { onDelete: "set null" }),
    replicaConfirmation: text("replica_confirmation"),
    evidencePackPath: text("evidence_pack_path"),
    /**
     * R6-01: the frozen filing record (src/lib/reports/filing-record.ts), written once with the submit approval and
     * never recomputed from live items. The receipt, Reports and the evidence pack print from it.
     */
    filingRecord: jsonb("filing_record").$type<object>(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("reports_company_idx").on(t.companyId),
    index("reports_status_idx").on(t.status),
    index("reports_state_idx").on(t.state),
  ],
);

export const recoveries = pgTable(
  "recoveries",
  {
    id: id(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    state: text("state").notNull(),
    amountCents: cents("amount_cents").notNull(),
    holderNameFound: text("holder_name_found"),
    matchedNameVariant: text("matched_name_variant"),
    matchConfidence: integer("match_confidence"), // 0..100
    status: recoveryStatusEnum("status").notNull().default("found"),
    claimPayload: jsonb("claim_payload").$type<Record<string, unknown>>(),
    approvalId: uuid("approval_id").references(() => approvals.id, { onDelete: "set null" }),
    claimConfirmation: text("claim_confirmation"),
    foundAt: timestamp("found_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("recoveries_company_idx").on(t.companyId),
    index("recoveries_status_idx").on(t.status),
  ],
);

export const agentRuns = pgTable(
  "agent_runs",
  {
    id: id(),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
    staleItemId: uuid("stale_item_id").references(() => staleItems.id, { onDelete: "set null" }),
    agent: text("agent").notNull(),
    model: text("model"),
    status: agentRunStatusEnum("status").notNull().default("running"),
    input: jsonb("input").$type<Record<string, unknown>>(),
    output: jsonb("output").$type<Record<string, unknown>>(),
    trace: jsonb("trace").$type<unknown[]>(),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    costUsdMicros: bigint("cost_usd_micros", { mode: "number" }),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    index("agent_runs_company_idx").on(t.companyId),
    index("agent_runs_stale_item_idx").on(t.staleItemId),
    index("agent_runs_status_idx").on(t.status),
  ],
);

export const evalCases = pgTable(
  "eval_cases",
  {
    id: id(),
    slice: evalSliceEnum("slice").notNull(),
    itemSnapshot: jsonb("item_snapshot").$type<Record<string, unknown>>().notNull(),
    expected: jsonb("expected").$type<Record<string, unknown>>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("eval_cases_slice_idx").on(t.slice)],
);

export const evalRuns = pgTable("eval_runs", {
  id: id(),
  runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
  workerModel: text("worker_model").notNull(),
  orchestratorModel: text("orchestrator_model").notNull(),
  ruleVersions: jsonb("rule_versions").$type<Record<string, string>>(),
  metrics: jsonb("metrics").$type<Record<string, unknown>>(),
});

export const evalResults = pgTable(
  "eval_results",
  {
    id: id(),
    runId: uuid("run_id")
      .notNull()
      .references(() => evalRuns.id, { onDelete: "cascade" }),
    caseId: uuid("case_id")
      .notNull()
      .references(() => evalCases.id, { onDelete: "cascade" }),
    actual: jsonb("actual").$type<Record<string, unknown>>(),
    pass: boolean("pass").notNull(),
    errorKind: text("error_kind"),
  },
  (t) => [
    index("eval_results_run_idx").on(t.runId),
    index("eval_results_case_idx").on(t.caseId),
    index("eval_results_pass_idx").on(t.pass),
  ],
);

export const simClock = pgTable("sim_clock", {
  companyId: uuid("company_id")
    .primaryKey()
    .references(() => companies.id, { onDelete: "cascade" }),
  offsetDays: integer("offset_days").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * R7-04: every change of the demo clock, so an event is dated by the demo day in force when it happened (its row only
 * carries a real timestamp). Written by advanceClock / resetClock; read by src/lib/clock-history.ts.
 */
export const demoClockEvents = pgTable(
  "demo_clock_events",
  {
    id: id(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    demoDay: date("demo_day", { mode: "string" }).notNull(),
    setAt: timestamp("set_at", { withTimezone: true }).notNull().defaultNow(),
    // R9-02: the event itself, stored once per clock move so Activity reads rows instead of inferring them. All NULL on
    // rows written before this existed (legacy: only demo_day and set_at are known).
    /** "move" (a jump) or "reset" (the clock Reset button). */
    kind: text("kind"),
    /** The demo day before the change. */
    prevDay: date("prev_day", { mode: "string" }),
    /** "forward" | "back" | "same", from prev_day to demo_day. */
    direction: text("direction"),
    /** Items the move newly detected as stale, and their total amount. */
    detectedCount: integer("detected_count"),
    detectedCents: cents("detected_cents"),
    /** Clock-detected items removed because the clock moved back before their stale date. */
    undetectedCount: integer("undetected_count"),
    /**
     * Forward moves only: Horizon's forecast made on prev_day (ledger ids + cents of payments it said would go stale by
     * demo_day) next to what the move detected, with the reason for each difference as observed at move time. See
     * src/lib/horizon/check.ts. NULL on back moves, resets and rows written before this existed ("not recorded").
     */
    horizonCheck: jsonb("horizon_check").$type<Record<string, unknown>>(),
  },
  (t) => [index("demo_clock_events_company_idx").on(t.companyId, t.setAt)],
);

/**
 * Tamper-evident audit chain (dogfood round 9, opportunity 3). One append-only row per recorded event, per company,
 * hash-chained: hash = sha256(canonical JSON of seq, prev_hash, occurred_at, kind, subject and payload). Written only by
 * appendAuditEvent (src/lib/audit/chain-db.ts) inside the transaction that made the change; verified by verifyChain.
 * Migration 0014 adds a trigger that refuses UPDATE on this table; 0015 adds triggers that refuse DELETE and TRUNCATE
 * (the demo reset opts out inside its own transaction, see seedDemo and drizzle/0015_period_close.sql).
 */
export const auditChain = pgTable(
  "audit_chain",
  {
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    /** 1, 2, 3... per company, no gaps. */
    seq: integer("seq").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    /** e.g. "clock.move", "approval.granted", "outreach.sent". */
    kind: text("kind").notNull(),
    subjectType: text("subject_type").notNull(),
    subjectId: text("subject_id").notNull(),
    /** Canonical JSON (sorted keys) of the facts recorded, stored as text so it is hashed byte for byte. */
    payload: text("payload").notNull(),
    /** Hash of the previous row, or 64 zeros for seq 1. */
    prevHash: text("prev_hash").notNull(),
    hash: text("hash").notNull(),
  },
  (t) => [uniqueIndex("audit_chain_company_seq_idx").on(t.companyId, t.seq)],
);

export type AuditChainRow = typeof auditChain.$inferSelect;

/**
 * A closed month (dogfood round 10, R10-01). One row per company and "YYYY-MM", written once by closePeriod
 * (src/lib/close-pack/close.ts) behind a server-enforced `close_period` approval, and never changed: migration 0015
 * refuses UPDATE, DELETE and TRUNCATE (the demo reset opts out inside its own transaction). It freezes the month's
 * journal entries and the exact close-pack ZIP that was handed out, so later downloads are byte-identical and
 * backdated detections post to the next open month as prior-period adjustments.
 */
export const periodCloses = pgTable(
  "period_closes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    /** "YYYY-MM". */
    period: text("period").notNull(),
    /** The demo-clock date when the month was closed. */
    demoDate: text("demo_date").notNull(),
    closedAt: timestamp("closed_at", { withTimezone: true }).notNull(),
    closedBy: text("closed_by").notNull(),
    approvalId: uuid("approval_id").notNull(),
    /** The month's journal entries as closed (JournalEntry[]). */
    journal: jsonb("journal").notNull(),
    journalSha256: text("journal_sha256").notNull(),
    /** sha256 of the pack's manifest.json bytes, also recorded in the audit chain. */
    manifestSha256: text("manifest_sha256").notNull(),
    /** The pack's manifest.json as handed out. */
    manifest: text("manifest").notNull(),
    /** The close-pack ZIP as handed out, base64. */
    packBase64: text("pack_base64").notNull(),
    fileCount: integer("file_count").notNull(),
    allTie: boolean("all_tie").notNull(),
    /** The audit-chain event "period.closed" that recorded the manifest hash. */
    chainSeq: integer("chain_seq").notNull(),
    chainHash: text("chain_hash").notNull(),
  },
  (t) => [uniqueIndex("period_closes_company_period_idx").on(t.companyId, t.period)],
);

export type PeriodClose = typeof periodCloses.$inferSelect;

/* ------------------------------------------------------ login rate limit */
// Token bucket per client key (see src/lib/auth/login-limiter.ts). Shared across restarts and instances.

export const loginAttempts = pgTable("login_attempts", {
  key: text("key").primaryKey(),
  tokens: doublePrecision("tokens").notNull(),
  /** Epoch ms of the last update (the refill clock). */
  updatedAtMs: bigint("updated_at_ms", { mode: "number" }).notNull(),
});

/* ------------------------------------------------- replica state portals */
// Storage for the REPLICA state portals (/replica/*). These stand in for an
// external government system and are deliberately separate from app tables.

export const replicaSubmissionStatusEnum = pgEnum("replica_submission_status", [
  "uploaded",
  "awaiting_approval",
  "submitted",
  "rejected",
]);

export const replicaSubmissions = pgTable(
  "replica_submissions",
  {
    id: id(),
    state: text("state").notNull(),
    holderName: text("holder_name").notNull(),
    holderLogin: text("holder_login").notNull(),
    fileName: text("file_name").notNull(),
    fileContent: text("file_content").notNull(),
    parsedSummary: jsonb("parsed_summary").$type<Record<string, unknown>>(),
    itemCount: integer("item_count"),
    totalCents: cents("total_cents"),
    status: replicaSubmissionStatusEnum("status").notNull().default("uploaded"),
    confirmationNumber: text("confirmation_number"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("replica_submissions_state_idx").on(t.state)],
);

export const replicaClaims = pgTable("replica_claims", {
  id: id(),
  state: text("state").notNull(),
  propertyId: text("property_id").notNull(),
  claimantName: text("claimant_name").notNull(),
  amountCents: cents("amount_cents").notNull(),
  confirmationNumber: text("confirmation_number").notNull(),
  createdAt: createdAt(),
});

/* ------------------------------------------------ integration connections */

export const integrationProviderEnum = pgEnum("integration_provider", ["qbo", "plaid"]);

export const integrationConnections = pgTable(
  "integration_connections",
  {
    id: id(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    provider: integrationProviderEnum("provider").notNull(),
    realmId: text("realm_id"),
    accessTokenEnc: text("access_token_enc"),
    refreshTokenEnc: text("refresh_token_enc"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    cursor: text("cursor"),
    createdAt: createdAt(),
  },
  (t) => [index("integration_connections_company_idx").on(t.companyId)],
);

/* ---------------------------------------------------------- inferred types */

export type Company = typeof companies.$inferSelect;
export type NewCompany = typeof companies.$inferInsert;
export type Payee = typeof payees.$inferSelect;
export type NewPayee = typeof payees.$inferInsert;
export type LedgerItem = typeof ledgerItems.$inferSelect;
export type NewLedgerItem = typeof ledgerItems.$inferInsert;
export type BankClear = typeof bankClears.$inferSelect;
export type NewBankClear = typeof bankClears.$inferInsert;
export type StaleItem = typeof staleItems.$inferSelect;
export type NewStaleItem = typeof staleItems.$inferInsert;
export type StateRule = typeof stateRules.$inferSelect;
export type NewStateRule = typeof stateRules.$inferInsert;
export type RuleChange = typeof ruleChanges.$inferSelect;
export type NewRuleChange = typeof ruleChanges.$inferInsert;
export type Approval = typeof approvals.$inferSelect;
export type NewApproval = typeof approvals.$inferInsert;
export type Outreach = typeof outreach.$inferSelect;
export type NewOutreach = typeof outreach.$inferInsert;
export type OutreachItem = typeof outreachItems.$inferSelect;
export type NewOutreachItem = typeof outreachItems.$inferInsert;
export type Report = typeof reports.$inferSelect;
export type NewReport = typeof reports.$inferInsert;
export type Recovery = typeof recoveries.$inferSelect;
export type NewRecovery = typeof recoveries.$inferInsert;
export type AgentRun = typeof agentRuns.$inferSelect;
export type NewAgentRun = typeof agentRuns.$inferInsert;
export type EvalCase = typeof evalCases.$inferSelect;
export type NewEvalCase = typeof evalCases.$inferInsert;
export type EvalRun = typeof evalRuns.$inferSelect;
export type NewEvalRun = typeof evalRuns.$inferInsert;
export type EvalResult = typeof evalResults.$inferSelect;
export type NewEvalResult = typeof evalResults.$inferInsert;
export type DemoClockEvent = typeof demoClockEvents.$inferSelect;
export type SimClock = typeof simClock.$inferSelect;
export type NewSimClock = typeof simClock.$inferInsert;

export type PropertyType = (typeof propertyTypeEnum.enumValues)[number];
export type StaleStatus = (typeof staleStatusEnum.enumValues)[number];
export type ApprovalAction = (typeof approvalActionEnum.enumValues)[number];
export type ReplicaSubmission = typeof replicaSubmissions.$inferSelect;
export type ReplicaClaim = typeof replicaClaims.$inferSelect;
export type IntegrationConnection = typeof integrationConnections.$inferSelect;
export type RuleApprovalRow = typeof ruleApprovals.$inferSelect;
export type NewRuleApprovalRow = typeof ruleApprovals.$inferInsert;
