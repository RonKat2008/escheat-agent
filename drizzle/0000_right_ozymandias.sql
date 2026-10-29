CREATE TYPE "public"."agent_run_status" AS ENUM('running', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."approval_action" AS ENUM('mail_letter', 'send_email', 'place_call', 'submit_report', 'file_claim', 'apply_rule_change');--> statement-breakpoint
CREATE TYPE "public"."clear_source" AS ENUM('csv', 'plaid', 'synthetic');--> statement-breakpoint
CREATE TYPE "public"."eval_slice" AS ENUM('generated', 'adversarial');--> statement-breakpoint
CREATE TYPE "public"."ledger_source" AS ENUM('csv', 'qbo', 'synthetic');--> statement-breakpoint
CREATE TYPE "public"."ledger_status" AS ENUM('outstanding', 'cleared', 'voided', 'reissued');--> statement-breakpoint
CREATE TYPE "public"."merge_basis" AS ENUM('exact', 'rule', 'model', 'human');--> statement-breakpoint
CREATE TYPE "public"."outreach_channel" AS ENUM('letter', 'email', 'voice');--> statement-breakpoint
CREATE TYPE "public"."outreach_status" AS ENUM('draft', 'awaiting_approval', 'approved', 'sent', 'delivered', 'failed', 'responded', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."owner_state_basis" AS ENUM('address', 'incorporation');--> statement-breakpoint
CREATE TYPE "public"."property_type" AS ENUM('vendor_check', 'payroll_check', 'customer_credit', 'unapplied_cash');--> statement-breakpoint
CREATE TYPE "public"."recovery_status" AS ENUM('found', 'claim_drafted', 'awaiting_approval', 'claim_submitted', 'paid', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."replica_submission_status" AS ENUM('uploaded', 'awaiting_approval', 'submitted', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."report_status" AS ENUM('draft', 'validated', 'awaiting_approval', 'approved', 'submitted', 'confirmed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."rule_change_status" AS ENUM('proposed', 'approved', 'rejected', 'applied');--> statement-breakpoint
CREATE TYPE "public"."stale_status" AS ENUM('watching', 'dd_pending', 'dd_sent', 'owner_responded', 'resolved_paid', 'to_report', 'reported', 'remitted', 'needs_rule');--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid,
	"stale_item_id" uuid,
	"agent" text NOT NULL,
	"model" text,
	"status" "agent_run_status" DEFAULT 'running' NOT NULL,
	"input" jsonb,
	"output" jsonb,
	"trace" jsonb,
	"input_tokens" integer,
	"output_tokens" integer,
	"cost_usd_micros" bigint,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"action" "approval_action" NOT NULL,
	"subject_id" text NOT NULL,
	"payload_sha256" text NOT NULL,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bank_clears" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"ledger_item_id" uuid,
	"reference_number" text,
	"amount_cents" bigint NOT NULL,
	"cleared_date" date NOT NULL,
	"description" text,
	"source" "clear_source" DEFAULT 'csv' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"incorporation_state" text NOT NULL,
	"hq_state" text,
	"address_line" text,
	"city" text,
	"zip" text,
	"fein" text,
	"is_synthetic" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eval_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slice" "eval_slice" NOT NULL,
	"item_snapshot" jsonb NOT NULL,
	"expected" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eval_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"actual" jsonb,
	"pass" boolean NOT NULL,
	"error_kind" text
);
--> statement-breakpoint
CREATE TABLE "eval_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"worker_model" text NOT NULL,
	"orchestrator_model" text NOT NULL,
	"rule_versions" jsonb,
	"metrics" jsonb
);
--> statement-breakpoint
CREATE TABLE "ledger_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"payee_id" uuid,
	"payee_name_raw" text NOT NULL,
	"property_type" "property_type" NOT NULL,
	"reference_number" text,
	"amount_cents" bigint NOT NULL,
	"issue_date" date NOT NULL,
	"last_activity_date" date,
	"status" "ledger_status" DEFAULT 'outstanding' NOT NULL,
	"address_line" text,
	"city" text,
	"state" text,
	"zip" text,
	"memo" text,
	"raw_row" jsonb,
	"source" "ledger_source" DEFAULT 'csv' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outreach" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"stale_item_id" uuid NOT NULL,
	"approval_id" uuid,
	"channel" "outreach_channel" NOT NULL,
	"status" "outreach_status" DEFAULT 'draft' NOT NULL,
	"to_address" text,
	"subject" text,
	"body" text,
	"provider_id" text,
	"token_hash" text,
	"preview_url" text,
	"tracking" jsonb,
	"offline" boolean DEFAULT false NOT NULL,
	"sent_at" timestamp with time zone,
	"responded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"canonical_name" text NOT NULL,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"address_line" text,
	"city" text,
	"state" text,
	"zip" text,
	"merge_basis" "merge_basis" DEFAULT 'exact' NOT NULL,
	"merge_confidence" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recoveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"state" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"holder_name_found" text,
	"matched_name_variant" text,
	"match_confidence" integer,
	"status" "recovery_status" DEFAULT 'found' NOT NULL,
	"claim_payload" jsonb,
	"approval_id" uuid,
	"claim_confirmation" text,
	"found_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "replica_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"state" text NOT NULL,
	"property_id" text NOT NULL,
	"claimant_name" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"confirmation_number" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "replica_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"state" text NOT NULL,
	"holder_name" text NOT NULL,
	"holder_login" text NOT NULL,
	"file_name" text NOT NULL,
	"file_content" text NOT NULL,
	"parsed_summary" jsonb,
	"item_count" integer,
	"total_cents" bigint,
	"status" "replica_submission_status" DEFAULT 'uploaded' NOT NULL,
	"confirmation_number" text,
	"submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"state" text NOT NULL,
	"report_year" integer NOT NULL,
	"format" text DEFAULT 'naupa' NOT NULL,
	"stage" text,
	"status" "report_status" DEFAULT 'draft' NOT NULL,
	"total_cents" bigint DEFAULT 0 NOT NULL,
	"item_count" integer DEFAULT 0 NOT NULL,
	"checksum" text,
	"file_path" text,
	"validation_errors" jsonb,
	"approval_id" uuid,
	"replica_confirmation" text,
	"evidence_pack_path" text,
	"submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rule_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"state" text NOT NULL,
	"from_version" text,
	"to_version" text,
	"diff" jsonb NOT NULL,
	"source_urls" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" "rule_change_status" DEFAULT 'proposed' NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sim_clock" (
	"company_id" uuid PRIMARY KEY NOT NULL,
	"offset_days" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stale_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"ledger_item_id" uuid NOT NULL,
	"owner_payee_id" uuid,
	"amount_cents" bigint NOT NULL,
	"property_type" "property_type" NOT NULL,
	"owner_state" text,
	"owner_state_basis" "owner_state_basis",
	"status" "stale_status" DEFAULT 'watching' NOT NULL,
	"stale_since" date NOT NULL,
	"presumed_abandoned_date" date,
	"dd_window_start" date,
	"dd_window_end" date,
	"report_due_date" date,
	"remit_due_date" date,
	"report_stage" text,
	"rule_version" text,
	"depends_on_unverified" boolean DEFAULT false NOT NULL,
	"classification" jsonb,
	"inngest_run_id" text,
	"deadline_moved_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "state_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"state" text NOT NULL,
	"version" text NOT NULL,
	"property_type" "property_type" NOT NULL,
	"dormancy_months" integer,
	"dd_window_days_min" integer,
	"dd_window_days_max" integer,
	"min_reportable_cents" bigint,
	"rule_json" jsonb NOT NULL,
	"field_sources" jsonb,
	"report_stages" jsonb,
	"interest_rule" jsonb,
	"source_urls" text[] DEFAULT '{}'::text[] NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"rule_file_sha" text,
	"effective_from" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_stale_item_id_stale_items_id_fk" FOREIGN KEY ("stale_item_id") REFERENCES "public"."stale_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_clears" ADD CONSTRAINT "bank_clears_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_clears" ADD CONSTRAINT "bank_clears_ledger_item_id_ledger_items_id_fk" FOREIGN KEY ("ledger_item_id") REFERENCES "public"."ledger_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_results" ADD CONSTRAINT "eval_results_run_id_eval_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."eval_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_results" ADD CONSTRAINT "eval_results_case_id_eval_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."eval_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_items" ADD CONSTRAINT "ledger_items_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_items" ADD CONSTRAINT "ledger_items_payee_id_payees_id_fk" FOREIGN KEY ("payee_id") REFERENCES "public"."payees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach" ADD CONSTRAINT "outreach_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach" ADD CONSTRAINT "outreach_stale_item_id_stale_items_id_fk" FOREIGN KEY ("stale_item_id") REFERENCES "public"."stale_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach" ADD CONSTRAINT "outreach_approval_id_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approvals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payees" ADD CONSTRAINT "payees_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recoveries" ADD CONSTRAINT "recoveries_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recoveries" ADD CONSTRAINT "recoveries_approval_id_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approvals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_approval_id_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approvals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sim_clock" ADD CONSTRAINT "sim_clock_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stale_items" ADD CONSTRAINT "stale_items_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stale_items" ADD CONSTRAINT "stale_items_ledger_item_id_ledger_items_id_fk" FOREIGN KEY ("ledger_item_id") REFERENCES "public"."ledger_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stale_items" ADD CONSTRAINT "stale_items_owner_payee_id_payees_id_fk" FOREIGN KEY ("owner_payee_id") REFERENCES "public"."payees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_runs_company_idx" ON "agent_runs" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "agent_runs_stale_item_idx" ON "agent_runs" USING btree ("stale_item_id");--> statement-breakpoint
CREATE INDEX "agent_runs_status_idx" ON "agent_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "approvals_subject_idx" ON "approvals" USING btree ("action","subject_id");--> statement-breakpoint
CREATE INDEX "bank_clears_company_idx" ON "bank_clears" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "bank_clears_ledger_item_idx" ON "bank_clears" USING btree ("ledger_item_id");--> statement-breakpoint
CREATE INDEX "eval_cases_slice_idx" ON "eval_cases" USING btree ("slice");--> statement-breakpoint
CREATE INDEX "eval_results_run_idx" ON "eval_results" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "eval_results_case_idx" ON "eval_results" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "eval_results_pass_idx" ON "eval_results" USING btree ("pass");--> statement-breakpoint
CREATE INDEX "ledger_items_company_idx" ON "ledger_items" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "ledger_items_payee_idx" ON "ledger_items" USING btree ("payee_id");--> statement-breakpoint
CREATE INDEX "ledger_items_status_idx" ON "ledger_items" USING btree ("status");--> statement-breakpoint
CREATE INDEX "outreach_company_idx" ON "outreach" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "outreach_stale_item_idx" ON "outreach" USING btree ("stale_item_id");--> statement-breakpoint
CREATE INDEX "outreach_status_idx" ON "outreach" USING btree ("status");--> statement-breakpoint
CREATE INDEX "payees_company_idx" ON "payees" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "payees_state_idx" ON "payees" USING btree ("state");--> statement-breakpoint
CREATE INDEX "recoveries_company_idx" ON "recoveries" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "recoveries_status_idx" ON "recoveries" USING btree ("status");--> statement-breakpoint
CREATE INDEX "replica_submissions_state_idx" ON "replica_submissions" USING btree ("state");--> statement-breakpoint
CREATE INDEX "reports_company_idx" ON "reports" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "reports_status_idx" ON "reports" USING btree ("status");--> statement-breakpoint
CREATE INDEX "reports_state_idx" ON "reports" USING btree ("state");--> statement-breakpoint
CREATE INDEX "rule_changes_state_idx" ON "rule_changes" USING btree ("state");--> statement-breakpoint
CREATE INDEX "rule_changes_status_idx" ON "rule_changes" USING btree ("status");--> statement-breakpoint
CREATE INDEX "stale_items_company_idx" ON "stale_items" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "stale_items_ledger_item_idx" ON "stale_items" USING btree ("ledger_item_id");--> statement-breakpoint
CREATE INDEX "stale_items_status_idx" ON "stale_items" USING btree ("status");--> statement-breakpoint
CREATE INDEX "stale_items_owner_state_idx" ON "stale_items" USING btree ("owner_state");--> statement-breakpoint
CREATE UNIQUE INDEX "state_rules_state_version_type_uq" ON "state_rules" USING btree ("state","version","property_type");