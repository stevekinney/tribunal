ALTER TABLE "agent_run" DROP CONSTRAINT "agent_run_agent_id_agent_id_fk";
--> statement-breakpoint
ALTER TABLE "agent_run" ADD COLUMN "agent_slug" text;--> statement-breakpoint
ALTER TABLE "agent_run" ADD COLUMN "agent_description" text;--> statement-breakpoint
UPDATE "agent_run"
SET
	"agent_slug" = "agent"."slug",
	"agent_description" = "agent"."description"
FROM "agent"
WHERE "agent_run"."agent_id" = "agent"."id"
	AND ("agent_run"."agent_slug" IS NULL OR "agent_run"."agent_description" IS NULL);--> statement-breakpoint
UPDATE "agent_run"
SET
	"agent_slug" = coalesce("agent_slug", "role"),
	"agent_description" = coalesce("agent_description", "role" || ' agent')
WHERE "agent_id" IS NULL;--> statement-breakpoint
ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE set null ON UPDATE no action;
