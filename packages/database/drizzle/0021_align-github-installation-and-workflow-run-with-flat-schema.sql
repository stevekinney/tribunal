ALTER TABLE "github_installation" ADD COLUMN "user_id" integer;--> statement-breakpoint
ALTER TABLE "github_installation" ADD CONSTRAINT "github_installation_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "github_installation_user_idx" ON "github_installation" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "workflow_run" DROP CONSTRAINT IF EXISTS "workflow_run_workspace_id_workspace_id_fk";
