ALTER TABLE "cost_event" DROP CONSTRAINT IF EXISTS "cost_event_kind_check";--> statement-breakpoint
ALTER TABLE "cost_event" DROP CONSTRAINT IF EXISTS "cost_event_agent_run_id_agent_run_id_fk";--> statement-breakpoint
DROP INDEX IF EXISTS "public"."cost_event_idempotency_key_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "public"."cost_event_agent_run_idx";--> statement-breakpoint
ALTER TABLE "cost_event" DROP COLUMN IF EXISTS "id";--> statement-breakpoint
ALTER TABLE "cost_event" DROP COLUMN IF EXISTS "kind";--> statement-breakpoint
ALTER TABLE "cost_event" DROP COLUMN IF EXISTS "agent_run_id";
