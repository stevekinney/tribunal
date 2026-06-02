CREATE TYPE "public"."action_item_source_type" AS ENUM('review_comment', 'issue_comment', 'review', 'ci_check_run', 'ci_annotation', 'composite');--> statement-breakpoint
CREATE TYPE "public"."action_item_status" AS ENUM('pending', 'in_progress', 'done');--> statement-breakpoint
CREATE TABLE "pull_request_action_item" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "pull_request_action_item_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"pull_request_state_id" integer NOT NULL,
	"stable_key" text NOT NULL,
	"subject" text NOT NULL,
	"description" text,
	"status" "action_item_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pull_request_action_item_dependency" (
	"action_item_id" integer NOT NULL,
	"depends_on_action_item_id" integer NOT NULL,
	CONSTRAINT "pull_request_action_item_dependency_action_item_id_depends_on_action_item_id_pk" PRIMARY KEY("action_item_id","depends_on_action_item_id"),
	CONSTRAINT "pull_request_action_item_dependency_no_self_ref" CHECK ("pull_request_action_item_dependency"."action_item_id" != "pull_request_action_item_dependency"."depends_on_action_item_id")
);
--> statement-breakpoint
CREATE TABLE "pull_request_action_item_source" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "pull_request_action_item_source_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"action_item_id" integer NOT NULL,
	"source_type" "action_item_source_type" NOT NULL,
	"source_identifier" text NOT NULL,
	"source_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pull_request_action_item" ADD CONSTRAINT "pull_request_action_item_pull_request_state_id_pull_request_state_id_fk" FOREIGN KEY ("pull_request_state_id") REFERENCES "public"."pull_request_state"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_request_action_item_dependency" ADD CONSTRAINT "pull_request_action_item_dependency_action_item_id_pull_request_action_item_id_fk" FOREIGN KEY ("action_item_id") REFERENCES "public"."pull_request_action_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_request_action_item_dependency" ADD CONSTRAINT "pull_request_action_item_dependency_depends_on_action_item_id_pull_request_action_item_id_fk" FOREIGN KEY ("depends_on_action_item_id") REFERENCES "public"."pull_request_action_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_request_action_item_source" ADD CONSTRAINT "pull_request_action_item_source_action_item_id_pull_request_action_item_id_fk" FOREIGN KEY ("action_item_id") REFERENCES "public"."pull_request_action_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pull_request_action_item_state_key_idx" ON "pull_request_action_item" USING btree ("pull_request_state_id","stable_key");--> statement-breakpoint
CREATE INDEX "pull_request_action_item_status_idx" ON "pull_request_action_item" USING btree ("status");--> statement-breakpoint
CREATE INDEX "pull_request_action_item_dependency_reverse_idx" ON "pull_request_action_item_dependency" USING btree ("depends_on_action_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pull_request_action_item_source_dedup_idx" ON "pull_request_action_item_source" USING btree ("action_item_id","source_type","source_identifier");