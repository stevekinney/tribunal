ALTER TYPE "public"."workflow_execution_status" ADD VALUE 'running' BEFORE 'completed';--> statement-breakpoint
ALTER TYPE "public"."workflow_execution_status" ADD VALUE 'cancelled';--> statement-breakpoint
ALTER TABLE "plan" ADD COLUMN "temporal_run_id" text;--> statement-breakpoint
ALTER TABLE "project_analysis" ADD COLUMN "temporal_run_id" text;