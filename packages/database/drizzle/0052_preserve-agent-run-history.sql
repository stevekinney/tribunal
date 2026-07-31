ALTER TABLE "agent_run" DROP CONSTRAINT IF EXISTS "agent_run_agent_id_agent_id_fk";
--> statement-breakpoint
ALTER TABLE "agent_run" ADD COLUMN IF NOT EXISTS "agent_slug" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_run" ADD COLUMN IF NOT EXISTS "agent_description" text DEFAULT '' NOT NULL;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'agent_run_agent_id_agent_id_fk'
      AND connamespace = 'public'::regnamespace
  ) THEN
    ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
