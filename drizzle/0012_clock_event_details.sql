ALTER TABLE "demo_clock_events" ADD COLUMN "kind" text;--> statement-breakpoint
ALTER TABLE "demo_clock_events" ADD COLUMN "prev_day" date;--> statement-breakpoint
ALTER TABLE "demo_clock_events" ADD COLUMN "direction" text;--> statement-breakpoint
ALTER TABLE "demo_clock_events" ADD COLUMN "detected_count" integer;--> statement-breakpoint
ALTER TABLE "demo_clock_events" ADD COLUMN "detected_cents" bigint;--> statement-breakpoint
ALTER TABLE "demo_clock_events" ADD COLUMN "undetected_count" integer;