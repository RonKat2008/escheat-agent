ALTER TABLE "period_closes" ADD COLUMN "snapshot" jsonb;--> statement-breakpoint
-- R11-01: the frozen roll-forward, tie-out and movement coverage of a closed month, written with the row at close time.
-- Adding a column fires no row trigger; the row stays immutable (UPDATE/DELETE still refused by 0015).
COMMENT ON COLUMN "period_closes"."snapshot" IS 'Frozen roll-forward, tie-out and movement coverage at close (R11-01). Null for closes before 0016.';
