CREATE TABLE "rule_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"state" text NOT NULL,
	"kind" text NOT NULL,
	"base_version" text NOT NULL,
	"base_sha256" text NOT NULL,
	"version" text NOT NULL,
	"field_paths" jsonb NOT NULL,
	"value" jsonb,
	"owner_text" text,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"note" text,
	"approved_by" text NOT NULL,
	"approved_at" timestamp with time zone NOT NULL,
	"approval_id" uuid,
	"withdrawn_at" timestamp with time zone,
	"withdrawn_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "rule_approvals_state_version_uq" ON "rule_approvals" USING btree ("state","version");--> statement-breakpoint
CREATE INDEX "rule_approvals_state_idx" ON "rule_approvals" USING btree ("state");