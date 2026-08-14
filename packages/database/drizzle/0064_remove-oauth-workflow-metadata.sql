ALTER TABLE "oauth_connection" DROP COLUMN IF EXISTS "last_checked_at";--> statement-breakpoint
ALTER TABLE "oauth_connection" DROP COLUMN IF EXISTS "created_at";--> statement-breakpoint
ALTER TABLE "oauth_connection" DROP COLUMN IF EXISTS "updated_at";--> statement-breakpoint
ALTER TABLE "workflow_run" DROP COLUMN IF EXISTS "cancellation_reason";--> statement-breakpoint
ALTER TABLE "workflow_run" DROP COLUMN IF EXISTS "completed_at";--> statement-breakpoint
ALTER TABLE "workflow_run" DROP COLUMN IF EXISTS "updated_at";
