ALTER TABLE "agent_run" DROP CONSTRAINT "agent_run_stopped_reason_check";--> statement-breakpoint
ALTER TABLE "agent_event" ALTER COLUMN "id" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "agent_event" ALTER COLUMN "id" SET MAXVALUE 9223372036854775807;--> statement-breakpoint
ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_stopped_reason_check" CHECK ("agent_run"."stopped_reason" IS NULL OR "agent_run"."stopped_reason" IN ('superseded','pr_closed','budget','timeout','operator'));
