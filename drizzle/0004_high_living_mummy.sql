CREATE TABLE "login_attempts" (
	"key" text PRIMARY KEY NOT NULL,
	"tokens" double precision NOT NULL,
	"updated_at_ms" bigint NOT NULL
);
