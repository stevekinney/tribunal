-- Generalizes the durable run model beyond pull request reviews.
--
-- `review_run` is split into a generic parent (`tribunal_run`, holding fields
-- true of any run kind) and a pull request review-specific child
-- (`pull_request_review_run`, preserving the legacy NOT NULL/CHECK/composite
-- uniqueness invariants exactly). Parent row ids are preserved from
-- `review_run.id` so identifiers embedded elsewhere (the signed GitHub
-- comment marker, agent run ids, capability tokens) remain valid without
-- remapping.
--
-- This is a single forward migration with in-migration integrity guards
-- (row-count and orphan checks) run before the destructive `DROP TABLE
-- review_run`. There is no rollback path once this migration is applied --
-- see the pull request description for the rollback story.
--
-- Restart safety: every statement that reads from `review_run` or the
-- (eventually dropped) `agent_run.review_run_id` column is wrapped in a
-- dynamic-SQL DO block guarded by an existence check. If this migration is
-- re-run after a partial failure (e.g. the destructive steps at the end
-- already ran but the migration wasn't recorded as applied), those guards
-- make every earlier step a safe no-op instead of erroring on a
-- since-dropped table or column.

-- Step 1: create the new tables (empty; backfilled below).
CREATE TABLE IF NOT EXISTS "pull_request_review_run" (
	"run_id" text PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"repository_id" bigint NOT NULL,
	"pr_number" integer NOT NULL,
	"head_sha" text NOT NULL,
	"prev_head_sha" text,
	"patch_id" text,
	"trigger" text NOT NULL,
	"check_run_id" bigint,
	"comments_posted" integer DEFAULT 0 NOT NULL,
	"review_post_claimed_at" timestamp with time zone,
	CONSTRAINT "pull_request_review_run_comments_posted_check" CHECK ("pull_request_review_run"."comments_posted" >= 0),
	CONSTRAINT "pull_request_review_run_trigger_check" CHECK ("pull_request_review_run"."trigger" IN ('opened','synchronize','reopened','manual'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tribunal_run" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"repository_id" bigint NOT NULL,
	"run_kind" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"workflow_id" text,
	"sandbox_id" text,
	"cost_estimate_usd" numeric DEFAULT '0' NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"error" text,
	CONSTRAINT "tribunal_run_kind_check" CHECK ("tribunal_run"."run_kind" IN ('pull_request_review','webhook_event_handler')),
	CONSTRAINT "tribunal_run_status_check" CHECK ("tribunal_run"."status" IN ('queued','running','posted','superseded','failed','cancelled','quota_blocked')),
	CONSTRAINT "tribunal_run_cost_estimate_check" CHECK ("tribunal_run"."cost_estimate_usd" >= 0)
);
--> statement-breakpoint

-- Step 2: foreign keys and indexes on the new tables. (A composite foreign
-- key enforcing that pull_request_review_run's denormalized user/repository
-- always match its parent tribunal_run is added in migration 0044.)
DO $$ BEGIN
	ALTER TABLE "tribunal_run" ADD CONSTRAINT "tribunal_run_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "tribunal_run" ADD CONSTRAINT "tribunal_run_repository_id_repository_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repository"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "pull_request_review_run" ADD CONSTRAINT "pull_request_review_run_run_id_tribunal_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."tribunal_run"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "pull_request_review_run" ADD CONSTRAINT "pull_request_review_run_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "pull_request_review_run" ADD CONSTRAINT "pull_request_review_run_repository_id_repository_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repository"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pull_request_review_run_user_repository_pr_head_trigger_idx" ON "pull_request_review_run" USING btree ("user_id","repository_id","pr_number","head_sha","trigger");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pull_request_review_run_repository_pr_idx" ON "pull_request_review_run" USING btree ("repository_id","pr_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pull_request_review_run_user_idx" ON "pull_request_review_run" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tribunal_run_user_idx" ON "tribunal_run" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tribunal_run_repository_run_kind_idx" ON "tribunal_run" USING btree ("repository_id","run_kind");--> statement-breakpoint

-- Step 3: backfill from review_run. Each block only runs while review_run
-- still exists, and the WHERE NOT EXISTS guards make re-running each block
-- safe (e.g. after a partial apply that got this far but no further).
DO $$
BEGIN
	IF to_regclass('public.review_run') IS NOT NULL THEN
		EXECUTE $migrate$
			INSERT INTO "tribunal_run" (
				"id", "user_id", "repository_id", "run_kind", "status", "workflow_id",
				"sandbox_id", "cost_estimate_usd", "started_at", "finished_at", "error"
			)
			SELECT
				"id", "user_id", "repository_id", 'pull_request_review', "status", "workflow_id",
				"sandbox_id", "cost_estimate_usd", "started_at", "finished_at", "error"
			FROM "review_run"
			WHERE NOT EXISTS (SELECT 1 FROM "tribunal_run" WHERE "tribunal_run"."id" = "review_run"."id")
		$migrate$;

		EXECUTE $migrate$
			INSERT INTO "pull_request_review_run" (
				"run_id", "user_id", "repository_id", "pr_number", "head_sha", "prev_head_sha",
				"patch_id", "trigger", "check_run_id", "comments_posted", "review_post_claimed_at"
			)
			SELECT
				"id", "user_id", "repository_id", "pr_number", "head_sha", "prev_head_sha",
				"patch_id", "trigger", "check_run_id", "comments_posted", "review_post_claimed_at"
			FROM "review_run"
			WHERE NOT EXISTS (
				SELECT 1 FROM "pull_request_review_run" WHERE "pull_request_review_run"."run_id" = "review_run"."id"
			)
		$migrate$;
	END IF;
END $$;
--> statement-breakpoint

-- Step 4: integrity guard -- every review_run row must map 1:1 to a
-- tribunal_run + pull_request_review_run pair before we touch anything else.
-- Skipped once review_run no longer exists: its absence only happens after
-- this migration's own Step 7 drop, meaning these checks already passed on
-- an earlier attempt.
DO $$
DECLARE
	review_run_count bigint;
	tribunal_run_count bigint;
	child_run_count bigint;
BEGIN
	IF to_regclass('public.review_run') IS NULL THEN
		RETURN;
	END IF;

	SELECT count(*) INTO review_run_count FROM "review_run";
	SELECT count(*) INTO tribunal_run_count FROM "tribunal_run" WHERE "run_kind" = 'pull_request_review';
	SELECT count(*) INTO child_run_count FROM "pull_request_review_run";

	IF review_run_count != tribunal_run_count THEN
		RAISE EXCEPTION 'review_run row count (%) does not match tribunal_run pull_request_review row count (%)',
			review_run_count, tribunal_run_count;
	END IF;

	IF review_run_count != child_run_count THEN
		RAISE EXCEPTION 'review_run row count (%) does not match pull_request_review_run row count (%)',
			review_run_count, child_run_count;
	END IF;

	IF EXISTS (
		SELECT 1 FROM "review_run" rr
		WHERE NOT EXISTS (SELECT 1 FROM "tribunal_run" tr WHERE tr."id" = rr."id")
			OR NOT EXISTS (SELECT 1 FROM "pull_request_review_run" prr WHERE prr."run_id" = rr."id")
	) THEN
		RAISE EXCEPTION 'Found review_run rows without a matching tribunal_run/pull_request_review_run pair';
	END IF;
END $$;
--> statement-breakpoint

-- Step 5: repoint agent_run from review_run_id to run_id (values unchanged --
-- parent ids equal the old review_run ids). The backfill UPDATE only runs
-- while the review_run_id column still exists.
ALTER TABLE "agent_run" ADD COLUMN IF NOT EXISTS "run_id" text;
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (
		SELECT 1 FROM information_schema.columns
		WHERE table_schema = 'public' AND table_name = 'agent_run' AND column_name = 'review_run_id'
	) THEN
		EXECUTE $migrate$
			UPDATE "agent_run" SET "run_id" = "review_run_id" WHERE "run_id" IS NULL
		$migrate$;
	END IF;
END $$;
--> statement-breakpoint
DO $$
DECLARE
	unresolved_count bigint;
BEGIN
	SELECT count(*) INTO unresolved_count FROM "agent_run" WHERE "run_id" IS NULL;
	IF unresolved_count > 0 THEN
		RAISE EXCEPTION 'Found % agent_run rows without a resolvable run_id after backfill', unresolved_count;
	END IF;

	SELECT count(*) INTO unresolved_count
	FROM "agent_run" ar
	WHERE NOT EXISTS (SELECT 1 FROM "tribunal_run" tr WHERE tr."id" = ar."run_id");
	IF unresolved_count > 0 THEN
		RAISE EXCEPTION 'Found % agent_run rows whose run_id does not resolve to a tribunal_run', unresolved_count;
	END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "agent_run" ALTER COLUMN "run_id" SET NOT NULL;
--> statement-breakpoint
DROP INDEX IF EXISTS "agent_run_review_run_agent_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "agent_run_review_run_idx";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_run_run_agent_idx" ON "agent_run" USING btree ("run_id","agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_run_run_idx" ON "agent_run" USING btree ("run_id");--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_run_id_tribunal_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."tribunal_run"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
ALTER TABLE "agent_run" DROP CONSTRAINT IF EXISTS "agent_run_review_run_id_review_run_id_fk";
--> statement-breakpoint
ALTER TABLE "agent_run" DROP COLUMN IF EXISTS "review_run_id";
--> statement-breakpoint

-- Step 6: repoint cost_event's review_run_id column (name unchanged, values
-- unchanged) from review_run to the generic tribunal_run parent.
ALTER TABLE "cost_event" DROP CONSTRAINT IF EXISTS "cost_event_review_run_id_review_run_id_fk";
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "cost_event" ADD CONSTRAINT "cost_event_review_run_id_tribunal_run_id_fk" FOREIGN KEY ("review_run_id") REFERENCES "public"."tribunal_run"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- Step 7: drop the legacy table now that nothing references it.
DROP TABLE IF EXISTS "review_run" CASCADE;
