CREATE TABLE "event_listener_delivery" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "event_listener_delivery_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"listener_id" text NOT NULL,
	"webhook_event_id" integer NOT NULL,
	"run_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"matched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"last_error" text,
	CONSTRAINT "event_listener_delivery_listener_webhook_event_unique" UNIQUE("listener_id","webhook_event_id"),
	CONSTRAINT "event_listener_delivery_status_check" CHECK ("event_listener_delivery"."status" IN ('pending','running','succeeded','failed','retryable','abandoned')),
	CONSTRAINT "event_listener_delivery_attempt_count_check" CHECK ("event_listener_delivery"."attempt_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "repository_event_listener" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"repository_id" bigint NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"event_type" text NOT NULL,
	"action" text,
	"filters_json" text DEFAULT '{}' NOT NULL,
	"agent_id" text NOT NULL,
	"instructions_markdown" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repository_event_listener_name_not_blank_check" CHECK (length(trim("repository_event_listener"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "webhook_event_handler_run" (
	"run_id" text PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"repository_id" bigint NOT NULL,
	"webhook_event_id" integer NOT NULL,
	"event_listener_id" text,
	"delivery_id" integer,
	"event_type" text NOT NULL,
	"action" text
);
--> statement-breakpoint
ALTER TABLE "event_listener_delivery" ADD CONSTRAINT "event_listener_delivery_listener_id_repository_event_listener_id_fk" FOREIGN KEY ("listener_id") REFERENCES "public"."repository_event_listener"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_listener_delivery" ADD CONSTRAINT "event_listener_delivery_webhook_event_id_webhook_event_id_fk" FOREIGN KEY ("webhook_event_id") REFERENCES "public"."webhook_event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_listener_delivery" ADD CONSTRAINT "event_listener_delivery_run_id_tribunal_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."tribunal_run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_event_listener" ADD CONSTRAINT "repository_event_listener_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_event_listener" ADD CONSTRAINT "repository_event_listener_repository_id_repository_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repository"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_event_listener" ADD CONSTRAINT "repository_event_listener_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_event_handler_run" ADD CONSTRAINT "webhook_event_handler_run_run_id_tribunal_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."tribunal_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_event_handler_run" ADD CONSTRAINT "webhook_event_handler_run_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_event_handler_run" ADD CONSTRAINT "webhook_event_handler_run_repository_id_repository_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repository"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_event_handler_run" ADD CONSTRAINT "webhook_event_handler_run_webhook_event_id_webhook_event_id_fk" FOREIGN KEY ("webhook_event_id") REFERENCES "public"."webhook_event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_event_handler_run" ADD CONSTRAINT "webhook_event_handler_run_event_listener_id_repository_event_listener_id_fk" FOREIGN KEY ("event_listener_id") REFERENCES "public"."repository_event_listener"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_event_handler_run" ADD CONSTRAINT "webhook_event_handler_run_delivery_id_event_listener_delivery_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."event_listener_delivery"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_event_handler_run" ADD CONSTRAINT "webhook_event_handler_run_run_user_repository_fk" FOREIGN KEY ("run_id","user_id","repository_id") REFERENCES "public"."tribunal_run"("id","user_id","repository_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_listener_delivery_run_idx" ON "event_listener_delivery" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "event_listener_delivery_status_idx" ON "event_listener_delivery" USING btree ("status");--> statement-breakpoint
CREATE INDEX "event_listener_delivery_listener_status_idx" ON "event_listener_delivery" USING btree ("listener_id","status");--> statement-breakpoint
CREATE INDEX "repository_event_listener_user_idx" ON "repository_event_listener" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "repository_event_listener_repository_idx" ON "repository_event_listener" USING btree ("repository_id");--> statement-breakpoint
CREATE INDEX "repository_event_listener_agent_idx" ON "repository_event_listener" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "repository_event_listener_repository_event_type_idx" ON "repository_event_listener" USING btree ("repository_id","event_type");--> statement-breakpoint
CREATE INDEX "webhook_event_handler_run_user_idx" ON "webhook_event_handler_run" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "webhook_event_handler_run_repository_idx" ON "webhook_event_handler_run" USING btree ("repository_id");--> statement-breakpoint
CREATE INDEX "webhook_event_handler_run_webhook_event_idx" ON "webhook_event_handler_run" USING btree ("webhook_event_id");--> statement-breakpoint
CREATE INDEX "webhook_event_handler_run_event_listener_idx" ON "webhook_event_handler_run" USING btree ("event_listener_id");--> statement-breakpoint
CREATE INDEX "webhook_event_handler_run_delivery_idx" ON "webhook_event_handler_run" USING btree ("delivery_id");