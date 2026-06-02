ALTER TABLE "sandbox_lifecycle_event" ALTER COLUMN "repository_id" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "sandbox_lifecycle_snapshot" ALTER COLUMN "repository_id" SET DATA TYPE bigint;--> statement-breakpoint
CREATE INDEX "sandbox_lifecycle_event_workflow_id_idx" ON "sandbox_lifecycle_event" USING btree ("workflow_id");