DROP INDEX IF EXISTS "webhook_event_repository_created_idx";
ALTER TABLE "github_webhook_delivery" DROP COLUMN IF EXISTS "processed_at";
ALTER TABLE "github_webhook_delivery" DROP COLUMN IF EXISTS "installation_id";
ALTER TABLE "webhook_event" DROP COLUMN IF EXISTS "sender_id";
ALTER TABLE "webhook_event" DROP COLUMN IF EXISTS "created_at";
