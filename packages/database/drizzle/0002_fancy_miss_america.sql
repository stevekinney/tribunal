CREATE TYPE "public"."sandbox_run_status" AS ENUM('active', 'closed', 'killed');--> statement-breakpoint
CREATE TABLE "sandbox_workflow_mapping" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sandbox_workflow_mapping_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"sandbox_id" text NOT NULL,
	"workflow_id" text NOT NULL,
	"task_queue" text NOT NULL,
	"workflow_type" text NOT NULL,
	"run_status" "sandbox_run_status" DEFAULT 'active' NOT NULL,
	"run_id" text,
	"phase_id" text,
	"phase_version" integer,
	"interaction_id" text,
	"workspace_id" integer NOT NULL,
	"project_id" integer NOT NULL,
	"repository_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sandbox_lifecycle_event" DROP CONSTRAINT "sandbox_lifecycle_event_repository_id_repository_id_fk";
--> statement-breakpoint
ALTER TABLE "sandbox_lifecycle_snapshot" DROP CONSTRAINT "sandbox_lifecycle_snapshot_repository_id_repository_id_fk";
--> statement-breakpoint
ALTER TABLE "sandbox_lifecycle_event" ALTER COLUMN "repository_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "sandbox_lifecycle_snapshot" ALTER COLUMN "repository_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "sandbox_lifecycle_event" ADD COLUMN "workflow_id" text;--> statement-breakpoint
ALTER TABLE "sandbox_lifecycle_event" ADD COLUMN "task_queue" text;--> statement-breakpoint
ALTER TABLE "sandbox_lifecycle_snapshot" ADD COLUMN "workflow_id" text;--> statement-breakpoint
ALTER TABLE "sandbox_lifecycle_snapshot" ADD COLUMN "task_queue" text;--> statement-breakpoint
ALTER TABLE "sandbox_workflow_mapping" ADD CONSTRAINT "sandbox_workflow_mapping_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sandbox_workflow_mapping" ADD CONSTRAINT "sandbox_workflow_mapping_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sandbox_workflow_mapping" ADD CONSTRAINT "sandbox_workflow_mapping_repository_id_repository_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repository"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sandbox_workflow_mapping_sandbox_id_unique" ON "sandbox_workflow_mapping" USING btree ("sandbox_id");--> statement-breakpoint
CREATE INDEX "sandbox_workflow_mapping_workflow_phase_idx" ON "sandbox_workflow_mapping" USING btree ("workflow_id","phase_id");--> statement-breakpoint
CREATE INDEX "sandbox_workflow_mapping_workspace_idx" ON "sandbox_workflow_mapping" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "sandbox_workflow_mapping_project_idx" ON "sandbox_workflow_mapping" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "sandbox_workflow_mapping_repository_idx" ON "sandbox_workflow_mapping" USING btree ("repository_id");--> statement-breakpoint
ALTER TABLE "sandbox_lifecycle_event" ADD CONSTRAINT "sandbox_lifecycle_event_repository_id_repository_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repository"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sandbox_lifecycle_snapshot" ADD CONSTRAINT "sandbox_lifecycle_snapshot_repository_id_repository_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repository"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sandbox_lifecycle_snapshot_workflow_id_idx" ON "sandbox_lifecycle_snapshot" USING btree ("workflow_id");