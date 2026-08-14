DROP INDEX IF EXISTS "repository_uri_idx";--> statement-breakpoint
ALTER TABLE "repository" DROP COLUMN IF EXISTS "uri";--> statement-breakpoint
ALTER TABLE "repository" DROP COLUMN IF EXISTS "created_at";--> statement-breakpoint
ALTER TABLE "repository" DROP COLUMN IF EXISTS "updated_at";
