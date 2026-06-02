CREATE TABLE "placeholder" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" integer NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"markdown" text NOT NULL,
	"snapshot" text NOT NULL,
	"frontmatter" text NOT NULL,
	"template" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "placeholder" ADD CONSTRAINT "placeholder_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "placeholder_workspace_idx" ON "placeholder" USING btree ("workspace_id");