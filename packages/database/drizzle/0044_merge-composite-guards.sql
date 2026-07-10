-- Closes a parent/child consistency gap in the run schema split introduced
-- by 0043: nothing previously stopped a `pull_request_review_run` row's
-- denormalized `user_id`/`repository_id` from diverging from its parent
-- `tribunal_run` row. This adds a composite foreign key backed by a named
-- UNIQUE constraint on the parent (a bare unique index is not accepted as a
-- foreign key reference target by every Postgres-compatible engine we run
-- against, including PGlite's migrator) so the database rejects divergence,
-- not just application code.
DO $$ BEGIN
	ALTER TABLE "tribunal_run" ADD CONSTRAINT "tribunal_run_id_user_repository_unique" UNIQUE("id","user_id","repository_id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "pull_request_review_run" ADD CONSTRAINT "pull_request_review_run_run_user_repository_fk" FOREIGN KEY ("run_id","user_id","repository_id") REFERENCES "public"."tribunal_run"("id","user_id","repository_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
