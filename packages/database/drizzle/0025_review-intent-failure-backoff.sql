ALTER TABLE "review_intent" ADD COLUMN IF NOT EXISTS "failed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "review_intent" ADD COLUMN IF NOT EXISTS "next_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "review_intent" ADD COLUMN IF NOT EXISTS "dead_lettered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "review_intent" ADD COLUMN IF NOT EXISTS "failure_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "review_intent" ALTER COLUMN "failure_count" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "review_intent" ADD COLUMN IF NOT EXISTS "last_error" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "review_intent" ADD CONSTRAINT "review_intent_failure_count_check" CHECK ("review_intent"."failure_count" >= 0);
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "review_intent_next_attempt_idx" ON "review_intent" USING btree ("next_attempt_at") WHERE "review_intent"."processed_at" IS NULL AND "review_intent"."dead_lettered_at" IS NULL;
