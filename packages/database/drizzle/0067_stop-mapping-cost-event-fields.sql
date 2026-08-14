-- Prepare the physical table for old and new application versions to overlap:
-- old writers may continue supplying id, kind, and agent_run_id, while new
-- writers omit them and use the existing idempotency key as event identity.
ALTER TABLE "cost_event" DROP CONSTRAINT "cost_event_pkey";--> statement-breakpoint
ALTER TABLE "cost_event" ALTER COLUMN "id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "cost_event" ALTER COLUMN "kind" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "cost_event" ADD CONSTRAINT "cost_event_pkey" PRIMARY KEY ("idempotency_key");

-- The retired columns, their remaining constraints, and the now-redundant
-- unique index stay physically present until this application version has been
-- verified in production. The follow-up migration will remove them.
