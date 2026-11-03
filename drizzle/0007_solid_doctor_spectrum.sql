CREATE TABLE "outreach_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outreach_id" uuid NOT NULL,
	"stale_item_id" uuid NOT NULL,
	"amount_cents" bigint NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "outreach_items" ADD CONSTRAINT "outreach_items_outreach_id_outreach_id_fk" FOREIGN KEY ("outreach_id") REFERENCES "public"."outreach"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_items" ADD CONSTRAINT "outreach_items_stale_item_id_stale_items_id_fk" FOREIGN KEY ("stale_item_id") REFERENCES "public"."stale_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "outreach_items_outreach_item_uq" ON "outreach_items" USING btree ("outreach_id","stale_item_id");--> statement-breakpoint
CREATE INDEX "outreach_items_stale_item_idx" ON "outreach_items" USING btree ("stale_item_id");