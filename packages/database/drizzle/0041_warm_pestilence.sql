ALTER TABLE "agent_event" DROP CONSTRAINT "agent_event_kind_check";--> statement-breakpoint
ALTER TABLE "agent_run" ALTER COLUMN "agent_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_run" ADD COLUMN "role" text DEFAULT 'specialist' NOT NULL;--> statement-breakpoint
ALTER TABLE "finding" ADD COLUMN "verification_status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "finding" ADD COLUMN "verification_note" text;--> statement-breakpoint
ALTER TABLE "finding" ADD COLUMN "verifier_agent_run_id" text;--> statement-breakpoint
ALTER TABLE "finding" ADD COLUMN "merged_fingerprints" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "review_run" ADD COLUMN "patch_id" text;--> statement-breakpoint
ALTER TABLE "finding" ADD CONSTRAINT "finding_verifier_agent_run_id_agent_run_id_fk" FOREIGN KEY ("verifier_agent_run_id") REFERENCES "public"."agent_run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_event" ADD CONSTRAINT "agent_event_kind_check" CHECK ("agent_event"."kind" IN ('session_start','tool_pre','tool_post','notification','message','usage','stop','error'));--> statement-breakpoint
ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_role_check" CHECK ("agent_run"."role" IN ('triage','specialist','verifier'));--> statement-breakpoint
ALTER TABLE "finding" ADD CONSTRAINT "finding_verification_status_check" CHECK ("finding"."verification_status" IN ('pending','verified','rejected'));