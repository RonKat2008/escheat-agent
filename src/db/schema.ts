import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
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
  "detected",
  "outreach_pending",
  "outreach_sent",
  "owner_responded",
  "resolved",
  "to_report",
  "reported",
  "remitted",
  "recovered",
  "unknown_rule",
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
    status: staleStatusEnum("status").notNull().default("detected"),
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
    index("stale_items_ledger_item_idx").on(t.ledgerItemId),
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
export type SimClock = typeof simClock.$inferSelect;
export type NewSimClock = typeof simClock.$inferInsert;

export type PropertyType = (typeof propertyTypeEnum.enumValues)[number];
export type StaleStatus = (typeof staleStatusEnum.enumValues)[number];
export type ApprovalAction = (typeof approvalActionEnum.enumValues)[number];
export type ReplicaSubmission = typeof replicaSubmissions.$inferSelect;
export type ReplicaClaim = typeof replicaClaims.$inferSelect;
