DROP INDEX "stale_items_ledger_item_idx";--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "fiscal_year_end" text DEFAULT '12-31' NOT NULL;--> statement-breakpoint
ALTER TABLE "stale_items" ADD COLUMN "property_code" text;--> statement-breakpoint
ALTER TABLE "stale_items" ADD COLUMN "last_activity_date" date;--> statement-breakpoint
ALTER TABLE "stale_items" ADD COLUMN "classification_confidence" integer;--> statement-breakpoint
ALTER TABLE "stale_items" ADD COLUMN "needs_review" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "stale_items_ledger_item_uq" ON "stale_items" USING btree ("ledger_item_id");