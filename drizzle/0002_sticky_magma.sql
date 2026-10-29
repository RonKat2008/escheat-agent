CREATE TYPE "public"."replica_submission_status" AS ENUM('uploaded', 'awaiting_approval', 'submitted', 'rejected');--> statement-breakpoint
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
CREATE INDEX "replica_submissions_state_idx" ON "replica_submissions" USING btree ("state");