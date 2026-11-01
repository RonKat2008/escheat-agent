ALTER TABLE "payees" ADD COLUMN "reviewed_by" text;--> statement-breakpoint
ALTER TABLE "payees" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payees" ADD COLUMN "review_action" text;