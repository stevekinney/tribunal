CREATE TABLE "agent_definition" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "agent_definition_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"project_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"configuration" jsonb NOT NULL,
	"created_by_user_id" integer NOT NULL,
	"updated_by_user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_definition" ADD CONSTRAINT "agent_definition_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_definition" ADD CONSTRAINT "agent_definition_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_definition" ADD CONSTRAINT "agent_definition_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_definition_project_id_idx" ON "agent_definition" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "agent_definition_created_by_user_id_idx" ON "agent_definition" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE INDEX "agent_definition_updated_by_user_id_idx" ON "agent_definition" USING btree ("updated_by_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_definition_project_id_name_idx" ON "agent_definition" USING btree ("project_id","name");
