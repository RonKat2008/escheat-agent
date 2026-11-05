ALTER TYPE "public"."approval_action" ADD VALUE 'close_period';--> statement-breakpoint
CREATE TABLE "period_closes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"period" text NOT NULL,
	"demo_date" text NOT NULL,
	"closed_at" timestamp with time zone NOT NULL,
	"closed_by" text NOT NULL,
	"approval_id" uuid NOT NULL,
	"journal" jsonb NOT NULL,
	"journal_sha256" text NOT NULL,
	"manifest_sha256" text NOT NULL,
	"manifest" text NOT NULL,
	"pack_base64" text NOT NULL,
	"file_count" integer NOT NULL,
	"all_tie" boolean NOT NULL,
	"chain_seq" integer NOT NULL,
	"chain_hash" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "period_closes" ADD CONSTRAINT "period_closes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "period_closes_company_period_idx" ON "period_closes" USING btree ("company_id","period");--> statement-breakpoint
-- R10-03: audit_chain and period_closes are append-only. UPDATE was already refused on audit_chain (0014); DELETE and
-- TRUNCATE are now refused too, so deleting the newest rows can no longer leave a shorter chain that still verifies.
-- The ONLY bypass is the transaction-local setting escheat.allow_reset = 'on', which seedDemo (the demo reset) sets
-- inside its own wipe transaction (SET LOCAL semantics via set_config(..., true)); it vanishes at commit/rollback.
CREATE OR REPLACE FUNCTION escheat_refuse_history_change() RETURNS trigger AS $$
BEGIN
  IF current_setting('escheat.allow_reset', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    IF TG_OP = 'UPDATE' THEN RETURN NEW; END IF;
    RETURN NULL;
  END IF;
  RAISE EXCEPTION '% is append-only: rows cannot be % (only the demo reset may clear it)', TG_TABLE_NAME, lower(TG_OP);
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER audit_chain_no_delete BEFORE DELETE ON "audit_chain" FOR EACH ROW EXECUTE FUNCTION escheat_refuse_history_change();--> statement-breakpoint
CREATE TRIGGER audit_chain_no_truncate BEFORE TRUNCATE ON "audit_chain" FOR EACH STATEMENT EXECUTE FUNCTION escheat_refuse_history_change();--> statement-breakpoint
CREATE TRIGGER period_closes_no_change BEFORE UPDATE OR DELETE ON "period_closes" FOR EACH ROW EXECUTE FUNCTION escheat_refuse_history_change();--> statement-breakpoint
CREATE TRIGGER period_closes_no_truncate BEFORE TRUNCATE ON "period_closes" FOR EACH STATEMENT EXECUTE FUNCTION escheat_refuse_history_change();
