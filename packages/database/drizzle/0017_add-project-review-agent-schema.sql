CREATE TYPE "public"."review_agent_policy" AS ENUM('all_prs', 'labeled_prs');--> statement-breakpoint
CREATE TYPE "public"."review_agent_scope" AS ENUM('all_repositories', 'selected_repositories');--> statement-breakpoint
CREATE TYPE "public"."review_agent_run_status" AS ENUM('pending', 'running', 'completed', 'failed', 'skipped');--> statement-breakpoint
CREATE TABLE "project_review_agent" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "project_review_agent_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"project_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"policy" "review_agent_policy" DEFAULT 'all_prs' NOT NULL,
	"scope" "review_agent_scope" DEFAULT 'all_repositories' NOT NULL,
	"required_labels" text,
	"instructions" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_review_agent_pattern" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "project_review_agent_pattern_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"agent_id" integer NOT NULL,
	"pattern" text NOT NULL,
	"order_index" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_review_agent_repository" (
	"agent_id" integer NOT NULL,
	"repository_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_review_agent_repository_agent_id_repository_id_pk" PRIMARY KEY("agent_id","repository_id")
);
--> statement-breakpoint
CREATE TABLE "project_review_agent_run" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "project_review_agent_run_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"agent_id" integer NOT NULL,
	"repository_id" bigint NOT NULL,
	"pr_number" integer NOT NULL,
	"head_sha" text NOT NULL,
	"status" "review_agent_run_status" DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"workflow_run_id" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_review_agent" ADD CONSTRAINT "project_review_agent_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_review_agent_pattern" ADD CONSTRAINT "project_review_agent_pattern_agent_id_project_review_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."project_review_agent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_review_agent_repository" ADD CONSTRAINT "project_review_agent_repository_agent_id_project_review_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."project_review_agent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_review_agent_repository" ADD CONSTRAINT "project_review_agent_repository_repository_id_repository_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repository"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_review_agent_run" ADD CONSTRAINT "project_review_agent_run_agent_id_project_review_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."project_review_agent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_review_agent_run" ADD CONSTRAINT "project_review_agent_run_repository_id_repository_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repository"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_review_agent_project_idx" ON "project_review_agent" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_review_agent_enabled_idx" ON "project_review_agent" USING btree ("project_id","enabled");--> statement-breakpoint
CREATE INDEX "project_review_agent_pattern_agent_order_idx" ON "project_review_agent_pattern" USING btree ("agent_id","order_index");--> statement-breakpoint
CREATE INDEX "project_review_agent_repository_repository_idx" ON "project_review_agent_repository" USING btree ("repository_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_review_agent_run_dedupe_idx" ON "project_review_agent_run" USING btree ("agent_id","repository_id","pr_number","head_sha");--> statement-breakpoint
CREATE INDEX "project_review_agent_run_agent_idx" ON "project_review_agent_run" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "project_review_agent_run_repo_pr_idx" ON "project_review_agent_run" USING btree ("repository_id","pr_number");--> statement-breakpoint
CREATE INDEX "project_review_agent_run_status_idx" ON "project_review_agent_run" USING btree ("status");
