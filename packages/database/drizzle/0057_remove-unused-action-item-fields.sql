DROP INDEX IF EXISTS "pull_request_action_item_status_idx";--> statement-breakpoint
ALTER TABLE "pull_request_action_item" DROP COLUMN IF EXISTS "subject";--> statement-breakpoint
ALTER TABLE "pull_request_action_item" DROP COLUMN IF EXISTS "description";--> statement-breakpoint
ALTER TABLE "pull_request_action_item" DROP COLUMN IF EXISTS "status";--> statement-breakpoint
ALTER TABLE "pull_request_action_item" DROP COLUMN IF EXISTS "created_at";--> statement-breakpoint
ALTER TABLE "pull_request_action_item" DROP COLUMN IF EXISTS "updated_at";--> statement-breakpoint
ALTER TABLE "pull_request_action_item_source" DROP COLUMN IF EXISTS "source_url";--> statement-breakpoint
ALTER TABLE "pull_request_action_item_source" DROP COLUMN IF EXISTS "created_at";
