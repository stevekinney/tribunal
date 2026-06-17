ALTER TABLE "workflow_run" DROP CONSTRAINT IF EXISTS "workflow_run_trigger_id_pull_request_trigger_id_fk";--> statement-breakpoint
ALTER TABLE "pull_request_trigger" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "pull_request_trigger" CASCADE;--> statement-breakpoint
DROP INDEX "workflow_run_error_code_idx";--> statement-breakpoint
DROP INDEX "workflow_run_retry_of_idx";--> statement-breakpoint
DROP INDEX "workflow_run_trigger_idx";--> statement-breakpoint
ALTER TABLE "workflow_run" DROP COLUMN "trigger_metadata";--> statement-breakpoint
ALTER TABLE "workflow_run" DROP COLUMN "template_alias";--> statement-breakpoint
ALTER TABLE "workflow_run" DROP COLUMN "template_id";--> statement-breakpoint
ALTER TABLE "workflow_run" DROP COLUMN "envd_version";--> statement-breakpoint
ALTER TABLE "workflow_run" DROP COLUMN "files_changed";--> statement-breakpoint
ALTER TABLE "workflow_run" DROP COLUMN "commit_sha";--> statement-breakpoint
ALTER TABLE "workflow_run" DROP COLUMN "tokens_used";--> statement-breakpoint
ALTER TABLE "workflow_run" DROP COLUMN "cost_usd";--> statement-breakpoint
ALTER TABLE "workflow_run" DROP COLUMN "error_code";--> statement-breakpoint
ALTER TABLE "workflow_run" DROP COLUMN "retry_of_workflow_id";--> statement-breakpoint
ALTER TABLE "workflow_run" DROP COLUMN "commits";--> statement-breakpoint
ALTER TABLE "workflow_run" DROP COLUMN "validation_warning";--> statement-breakpoint
ALTER TABLE "workflow_run" DROP COLUMN "resolution_artifact";--> statement-breakpoint
ALTER TABLE "workflow_run" DROP COLUMN "artifacts";--> statement-breakpoint
ALTER TABLE "workflow_run" DROP COLUMN "trigger_actor_id";--> statement-breakpoint
ALTER TABLE "workflow_run" DROP COLUMN "orchestrator_workflow_id";--> statement-breakpoint
ALTER TABLE "workflow_run" DROP COLUMN "trigger_id";--> statement-breakpoint
DROP TYPE "public"."pull_request_trigger_status";--> statement-breakpoint
DROP TYPE "public"."pull_request_trigger_type";
