-- Closes a parent/child consistency gap in the run schema split introduced
-- by 0043: nothing previously stopped a `pull_request_review_run` row's
-- denormalized `user_id`/`repository_id` from diverging from its parent
-- `tribunal_run` row. This adds a composite foreign key backed by a
-- composite unique index on the parent so the database rejects divergence,
-- not just application code.
CREATE UNIQUE INDEX IF NOT EXISTS "tribunal_run_id_user_repository_idx" ON "tribunal_run" USING btree ("id","user_id","repository_id");
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "pull_request_review_run" ADD CONSTRAINT "pull_request_review_run_run_user_repository_fk" FOREIGN KEY ("run_id","user_id","repository_id") REFERENCES "public"."tribunal_run"("id","user_id","repository_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
