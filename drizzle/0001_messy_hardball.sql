CREATE TYPE "public"."clear_source" AS ENUM('csv', 'plaid', 'synthetic');--> statement-breakpoint
CREATE TYPE "public"."ledger_source" AS ENUM('csv', 'qbo', 'synthetic');--> statement-breakpoint
ALTER TABLE "bank_clears" ADD COLUMN "source" "clear_source" DEFAULT 'csv' NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_items" ADD COLUMN "source" "ledger_source" DEFAULT 'csv' NOT NULL;