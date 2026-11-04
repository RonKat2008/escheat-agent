ALTER TYPE "public"."approval_action" ADD VALUE 'discard_draft';--> statement-breakpoint
ALTER TABLE "approvals" ADD COLUMN "reason" text;