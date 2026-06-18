CREATE TABLE "agent" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"slug" text NOT NULL,
	"description" text NOT NULL,
	"body" text NOT NULL,
	"model" text DEFAULT 'inherit' NOT NULL,
	"effort" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_model_check" CHECK ("agent"."model" ~ '^(sonnet|opus|haiku|fable|inherit|claude-[a-z0-9-]+)$'),
	CONSTRAINT "agent_effort_check" CHECK ("agent"."effort" IS NULL OR "agent"."effort" IN ('low','medium','high','xhigh','max'))
);
--> statement-breakpoint
CREATE TABLE "agent_event" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "agent_event_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"agent_run_id" text NOT NULL,
	"seq" integer NOT NULL,
	"kind" text NOT NULL,
	"tool" text,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_event_kind_check" CHECK ("agent_event"."kind" IN ('session_start','tool_pre','tool_post','notification','message','stop','error')),
	CONSTRAINT "agent_event_seq_check" CHECK ("agent_event"."seq" >= 0)
);
--> statement-breakpoint
CREATE TABLE "agent_run" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"review_run_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"model_used" text,
	"effort_used" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"findings_count" integer DEFAULT 0 NOT NULL,
	"input_tokens" bigint DEFAULT 0 NOT NULL,
	"output_tokens" bigint DEFAULT 0 NOT NULL,
	"cache_read_tokens" bigint DEFAULT 0 NOT NULL,
	"cache_creation_tokens" bigint DEFAULT 0 NOT NULL,
	"cost_estimate_usd" numeric DEFAULT '0' NOT NULL,
	"duration_ms" integer,
	"stopped_reason" text,
	"error" text,
	CONSTRAINT "agent_run_status_check" CHECK ("agent_run"."status" IN ('queued','running','succeeded','failed','cancelled')),
	CONSTRAINT "agent_run_effort_used_check" CHECK ("agent_run"."effort_used" IS NULL OR "agent_run"."effort_used" IN ('low','medium','high','xhigh','max')),
	CONSTRAINT "agent_run_stopped_reason_check" CHECK ("agent_run"."stopped_reason" IS NULL OR "agent_run"."stopped_reason" IN ('superseded','pr_closed','budget','timeout')),
	CONSTRAINT "agent_run_findings_count_check" CHECK ("agent_run"."findings_count" >= 0),
	CONSTRAINT "agent_run_input_tokens_check" CHECK ("agent_run"."input_tokens" >= 0),
	CONSTRAINT "agent_run_output_tokens_check" CHECK ("agent_run"."output_tokens" >= 0),
	CONSTRAINT "agent_run_cache_read_tokens_check" CHECK ("agent_run"."cache_read_tokens" >= 0),
	CONSTRAINT "agent_run_cache_creation_tokens_check" CHECK ("agent_run"."cache_creation_tokens" >= 0),
	CONSTRAINT "agent_run_cost_estimate_check" CHECK ("agent_run"."cost_estimate_usd" >= 0)
);
--> statement-breakpoint
CREATE TABLE "cost_event" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"kind" text NOT NULL,
	"source" text DEFAULT 'estimate' NOT NULL,
	"repository_id" bigint,
	"review_run_id" text,
	"agent_run_id" text,
	"agent_id" text,
	"amount_usd" numeric NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"idempotency_key" text NOT NULL,
	CONSTRAINT "cost_event_kind_check" CHECK ("cost_event"."kind" IN ('llm','sandbox')),
	CONSTRAINT "cost_event_source_check" CHECK ("cost_event"."source" IN ('estimate','reconciled')),
	CONSTRAINT "cost_event_amount_check" CHECK ("cost_event"."amount_usd" >= 0)
);
--> statement-breakpoint
CREATE TABLE "finding" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"agent_run_id" text NOT NULL,
	"path" text NOT NULL,
	"start_line" integer,
	"end_line" integer,
	"side" text DEFAULT 'RIGHT' NOT NULL,
	"severity" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"suggestion" text,
	"anchored" boolean DEFAULT false NOT NULL,
	"github_comment_id" bigint,
	"fingerprint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finding_side_check" CHECK ("finding"."side" IN ('LEFT','RIGHT')),
	CONSTRAINT "finding_severity_check" CHECK ("finding"."severity" IN ('info','warning','error')),
	CONSTRAINT "finding_start_line_check" CHECK ("finding"."start_line" IS NULL OR "finding"."start_line" > 0),
	CONSTRAINT "finding_end_line_check" CHECK ("finding"."end_line" IS NULL OR "finding"."end_line" > 0)
);
--> statement-breakpoint
CREATE TABLE "repository_agent" (
	"repository_id" bigint NOT NULL,
	"agent_id" text NOT NULL,
	CONSTRAINT "repository_agent_repository_id_agent_id_pk" PRIMARY KEY("repository_id","agent_id")
);
--> statement-breakpoint
CREATE TABLE "repository_review_settings" (
	"repository_id" bigint PRIMARY KEY NOT NULL,
	"watched" boolean DEFAULT false NOT NULL,
	"ignore_globs" text[] DEFAULT '{}'::text[] NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_intent" (
	"id" text PRIMARY KEY NOT NULL,
	"delivery_id" text NOT NULL,
	"kind" text NOT NULL,
	"repository_id" bigint NOT NULL,
	"pr_number" integer NOT NULL,
	"head_sha" text,
	"pr_state" text,
	"claimed_at" timestamp with time zone,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_intent_kind_check" CHECK ("review_intent"."kind" IN ('start','commit_pushed','pr_closed')),
	CONSTRAINT "review_intent_pr_state_check" CHECK ("review_intent"."pr_state" IS NULL OR "review_intent"."pr_state" IN ('merged','closed'))
);
--> statement-breakpoint
CREATE TABLE "review_run" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"repository_id" bigint NOT NULL,
	"pr_number" integer NOT NULL,
	"head_sha" text NOT NULL,
	"prev_head_sha" text,
	"trigger" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"workflow_id" text,
	"sandbox_id" text,
	"check_run_id" bigint,
	"comments_posted" integer DEFAULT 0 NOT NULL,
	"cost_estimate_usd" numeric DEFAULT '0' NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"error" text,
	CONSTRAINT "review_run_status_check" CHECK ("review_run"."status" IN ('queued','running','posted','superseded','failed','cancelled','quota_blocked')),
	CONSTRAINT "review_run_trigger_check" CHECK ("review_run"."trigger" IN ('opened','synchronize','reopened','manual')),
	CONSTRAINT "review_run_comments_posted_check" CHECK ("review_run"."comments_posted" >= 0),
	CONSTRAINT "review_run_cost_estimate_check" CHECK ("review_run"."cost_estimate_usd" >= 0)
);
--> statement-breakpoint
CREATE TABLE "user_review_settings" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"daily_cost_cap_usd" numeric DEFAULT '25' NOT NULL,
	"reviews_enabled" boolean DEFAULT true NOT NULL,
	"default_model" text DEFAULT 'claude-sonnet-4-6' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_review_settings_daily_cost_cap_check" CHECK ("user_review_settings"."daily_cost_cap_usd" >= 0)
);
--> statement-breakpoint
ALTER TABLE "agent" ADD CONSTRAINT "agent_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_event" ADD CONSTRAINT "agent_event_agent_run_id_agent_run_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_review_run_id_review_run_id_fk" FOREIGN KEY ("review_run_id") REFERENCES "public"."review_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_event" ADD CONSTRAINT "cost_event_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_event" ADD CONSTRAINT "cost_event_repository_id_repository_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repository"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_event" ADD CONSTRAINT "cost_event_review_run_id_review_run_id_fk" FOREIGN KEY ("review_run_id") REFERENCES "public"."review_run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_event" ADD CONSTRAINT "cost_event_agent_run_id_agent_run_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_event" ADD CONSTRAINT "cost_event_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finding" ADD CONSTRAINT "finding_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finding" ADD CONSTRAINT "finding_agent_run_id_agent_run_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_agent" ADD CONSTRAINT "repository_agent_repository_id_repository_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repository"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_agent" ADD CONSTRAINT "repository_agent_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_review_settings" ADD CONSTRAINT "repository_review_settings_repository_id_repository_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repository"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_intent" ADD CONSTRAINT "review_intent_repository_id_repository_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repository"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_run" ADD CONSTRAINT "review_run_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_run" ADD CONSTRAINT "review_run_repository_id_repository_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repository"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_review_settings" ADD CONSTRAINT "user_review_settings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_user_slug_idx" ON "agent" USING btree ("user_id","slug");--> statement-breakpoint
CREATE INDEX "agent_user_idx" ON "agent" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_event_agent_run_seq_idx" ON "agent_event" USING btree ("agent_run_id","seq");--> statement-breakpoint
CREATE INDEX "agent_event_agent_run_idx" ON "agent_event" USING btree ("agent_run_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_run_review_run_agent_idx" ON "agent_run" USING btree ("review_run_id","agent_id");--> statement-breakpoint
CREATE INDEX "agent_run_review_run_idx" ON "agent_run" USING btree ("review_run_id");--> statement-breakpoint
CREATE INDEX "agent_run_user_idx" ON "agent_run" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "agent_run_agent_idx" ON "agent_run" USING btree ("agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cost_event_idempotency_key_idx" ON "cost_event" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "cost_event_user_occurred_idx" ON "cost_event" USING btree ("user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "cost_event_review_run_idx" ON "cost_event" USING btree ("review_run_id");--> statement-breakpoint
CREATE INDEX "cost_event_repository_agent_idx" ON "cost_event" USING btree ("repository_id","agent_id");--> statement-breakpoint
CREATE INDEX "cost_event_source_idx" ON "cost_event" USING btree ("source");--> statement-breakpoint
CREATE INDEX "cost_event_agent_run_idx" ON "cost_event" USING btree ("agent_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "finding_agent_run_fingerprint_idx" ON "finding" USING btree ("agent_run_id","fingerprint");--> statement-breakpoint
CREATE INDEX "finding_agent_run_idx" ON "finding" USING btree ("agent_run_id");--> statement-breakpoint
CREATE INDEX "finding_user_idx" ON "finding" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "repository_agent_agent_idx" ON "repository_agent" USING btree ("agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "review_intent_delivery_kind_idx" ON "review_intent" USING btree ("delivery_id","kind");--> statement-breakpoint
CREATE INDEX "review_intent_unprocessed_claimed_idx" ON "review_intent" USING btree ("claimed_at") WHERE "review_intent"."processed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "review_intent_repository_pr_idx" ON "review_intent" USING btree ("repository_id","pr_number");--> statement-breakpoint
CREATE UNIQUE INDEX "review_run_user_repository_pr_head_trigger_idx" ON "review_run" USING btree ("user_id","repository_id","pr_number","head_sha","trigger");--> statement-breakpoint
CREATE INDEX "review_run_repository_pr_status_idx" ON "review_run" USING btree ("repository_id","pr_number","status");--> statement-breakpoint
CREATE INDEX "review_run_user_idx" ON "review_run" USING btree ("user_id");
