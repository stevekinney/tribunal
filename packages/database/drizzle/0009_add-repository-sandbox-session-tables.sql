CREATE TYPE "public"."repository_sandbox_session_status" AS ENUM('active', 'terminated', 'expired', 'error');--> statement-breakpoint
CREATE TABLE "repository_sandbox_session" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "repository_sandbox_session_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"sandbox_id" text NOT NULL,
	"workspace_id" integer NOT NULL,
	"project_id" integer NOT NULL,
	"repository_id" bigint,
	"user_id" integer NOT NULL,
	"status" "repository_sandbox_session_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "repository_sandbox_terminal_event" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "repository_sandbox_terminal_event_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"session_id" integer NOT NULL,
	"command_id" text NOT NULL,
	"sequence_number" integer NOT NULL,
	"event_type" text NOT NULL,
	"content" text NOT NULL,
	"exit_code" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "repository_sandbox_session" ADD CONSTRAINT "repository_sandbox_session_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_sandbox_session" ADD CONSTRAINT "repository_sandbox_session_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_sandbox_session" ADD CONSTRAINT "repository_sandbox_session_repository_id_repository_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repository"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_sandbox_session" ADD CONSTRAINT "repository_sandbox_session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_sandbox_terminal_event" ADD CONSTRAINT "repository_sandbox_terminal_event_session_id_repository_sandbox_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."repository_sandbox_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "repository_sandbox_session_sandbox_id_unique" ON "repository_sandbox_session" USING btree ("sandbox_id");--> statement-breakpoint
CREATE INDEX "repository_sandbox_session_repository_created_idx" ON "repository_sandbox_session" USING btree ("repository_id","created_at");--> statement-breakpoint
CREATE INDEX "repository_sandbox_session_workspace_idx" ON "repository_sandbox_session" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "repository_sandbox_session_project_idx" ON "repository_sandbox_session" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "repository_sandbox_session_user_idx" ON "repository_sandbox_session" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "repository_sandbox_terminal_event_session_seq_unique" ON "repository_sandbox_terminal_event" USING btree ("session_id","sequence_number");--> statement-breakpoint
CREATE INDEX "repository_sandbox_terminal_event_session_command_idx" ON "repository_sandbox_terminal_event" USING btree ("session_id","command_id");--> statement-breakpoint
CREATE INDEX "repository_sandbox_terminal_event_session_created_idx" ON "repository_sandbox_terminal_event" USING btree ("session_id","created_at");