CREATE TABLE "audit_chain" (
	"company_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"kind" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"payload" text NOT NULL,
	"prev_hash" text NOT NULL,
	"hash" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_chain" ADD CONSTRAINT "audit_chain_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "audit_chain_company_seq_idx" ON "audit_chain" USING btree ("company_id","seq");--> statement-breakpoint
CREATE OR REPLACE FUNCTION audit_chain_refuse_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_chain is append-only: rows cannot be updated';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER audit_chain_no_update BEFORE UPDATE ON "audit_chain" FOR EACH ROW EXECUTE FUNCTION audit_chain_refuse_update();
