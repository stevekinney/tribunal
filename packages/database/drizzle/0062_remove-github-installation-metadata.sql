ALTER TABLE "github_installation" DROP COLUMN IF EXISTS "account_type";--> statement-breakpoint
ALTER TABLE "github_installation" DROP COLUMN IF EXISTS "repository_selection";--> statement-breakpoint
ALTER TABLE "github_installation" DROP COLUMN IF EXISTS "status_reason";--> statement-breakpoint
ALTER TABLE "github_installation" DROP COLUMN IF EXISTS "last_synced_at";--> statement-breakpoint
ALTER TABLE "github_installation" DROP COLUMN IF EXISTS "sync_error";--> statement-breakpoint
ALTER TABLE "github_installation" DROP COLUMN IF EXISTS "created_at";--> statement-breakpoint
ALTER TABLE "github_installation" DROP COLUMN IF EXISTS "updated_at";--> statement-breakpoint
ALTER TABLE "github_installation_repository" DROP COLUMN IF EXISTS "removed_at";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."github_account_type";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."repository_selection";
