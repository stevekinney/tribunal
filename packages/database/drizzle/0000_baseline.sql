CREATE TYPE "public"."auth_provider" AS ENUM('github', 'google');--> statement-breakpoint
CREATE TYPE "public"."branch_update_strategy" AS ENUM('merge', 'rebase');--> statement-breakpoint
CREATE TYPE "public"."credential_role" AS ENUM('app_actor', 'webhook_admin');--> statement-breakpoint
CREATE TYPE "public"."credential_type" AS ENUM('oauth', 'service_account');--> statement-breakpoint
CREATE TYPE "public"."document_status" AS ENUM('draft', 'pending_review', 'approved', 'archived');--> statement-breakpoint
CREATE TYPE "public"."draft_triggered_by" AS ENUM('initial', 'revision');--> statement-breakpoint
CREATE TYPE "public"."error_category" AS ENUM('retryable', 'correctable', 'terminal');--> statement-breakpoint
CREATE TYPE "public"."flow_status" AS ENUM('active', 'completed');--> statement-breakpoint
CREATE TYPE "public"."flow_type" AS ENUM('ideation');--> statement-breakpoint
CREATE TYPE "public"."github_account_type" AS ENUM('Organization', 'User');--> statement-breakpoint
CREATE TYPE "public"."github_installation_status" AS ENUM('active', 'suspended', 'needs_permissions', 'error');--> statement-breakpoint
CREATE TYPE "public"."goal_scope" AS ENUM('single_line', 'multiple_lines_same_file', 'multiple_files_same_module', 'cross_module', 'cross_code_source');--> statement-breakpoint
CREATE TYPE "public"."goal_status" AS ENUM('draft', 'active', 'completed', 'archived');--> statement-breakpoint
CREATE TYPE "public"."goal_workflow_phase" AS ENUM('created', 'planning', 'planned', 'started', 'completed', 'wontdo');--> statement-breakpoint
CREATE TYPE "public"."integration_audit_event" AS ENUM('connected', 'disconnected', 'reauth', 'invalidated', 'revoked', 'resource_added', 'resource_removed', 'resource_synced');--> statement-breakpoint
CREATE TYPE "public"."integration_provider" AS ENUM('linear', 'slack', 'notion', 'google_drive');--> statement-breakpoint
CREATE TYPE "public"."integration_status" AS ENUM('active', 'invalid', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."invitation_status" AS ENUM('pending', 'accepted', 'declined', 'expired');--> statement-breakpoint
CREATE TYPE "public"."issue_reference_type" AS ENUM('linear', 'github');--> statement-breakpoint
CREATE TYPE "public"."oauth_actor" AS ENUM('app', 'user');--> statement-breakpoint
CREATE TYPE "public"."oauth_provider" AS ENUM('github', 'linear');--> statement-breakpoint
CREATE TYPE "public"."oauth_status" AS ENUM('active', 'invalid', 'expired');--> statement-breakpoint
CREATE TYPE "public"."phase_execution_status" AS ENUM('not_started', 'generating', 'pending_review', 'revising', 'completed');--> statement-breakpoint
CREATE TYPE "public"."phase_template_category" AS ENUM('core', 'analysis', 'synthesis', 'mapping');--> statement-breakpoint
CREATE TYPE "public"."pipeline_run_status" AS ENUM('started', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."platform_admin_action" AS ENUM('granted', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."push_conflict_policy" AS ENUM('abort');--> statement-breakpoint
CREATE TYPE "public"."question_option_order" AS ENUM('manual', 'random');--> statement-breakpoint
CREATE TYPE "public"."question_status" AS ENUM('draft', 'active', 'answered', 'archived');--> statement-breakpoint
CREATE TYPE "public"."question_type" AS ENUM('free_form', 'short_answer', 'multiple_choice', 'long_form', 'true_false', 'slider', 'stack_ranking', 'numeric');--> statement-breakpoint
CREATE TYPE "public"."repository_selection" AS ENUM('all', 'selected');--> statement-breakpoint
CREATE TYPE "public"."resource_type" AS ENUM('team', 'channel', 'database', 'folder', 'project', 'drive');--> statement-breakpoint
CREATE TYPE "public"."session_event_subtype" AS ENUM('text', 'question-response', 'permission-response', 'approve-or-reject-create-plan', 'approve-or-reject-create-goal', 'plan-response', 'task-iteration-response', 'abort', 'decision-started', 'decision-made', 'identification-started', 'identification-complete', 'claude-session-started', 'claude-session-completed', 'plan-update-started', 'plan-update-completed', 'assistant-response', 'plan-generation-started', 'plan-generation-updated', 'plan-generation-completed', 'plan-iteration-completed', 'question-generation-started', 'question-generation-completed', 'goal-created', 'task-generation-started', 'task-generation-completed', 'task-iteration-completed', 'flow-created', 'flow-updated', 'flow-completed');--> statement-breakpoint
CREATE TYPE "public"."sync_status" AS ENUM('idle', 'pending', 'in_progress', 'failed');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('pending', 'in_progress', 'completed', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."workflow_phase" AS ENUM('pending', 'provisioning', 'cloning', 'executing', 'capturing', 'cleanup', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."workflow_task_type" AS ENUM('analysis', 'remediation', 'implementation');--> statement-breakpoint
CREATE TYPE "public"."workflow_execution_status" AS ENUM('pending', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."workspace_role" AS ENUM('administrator', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."automation_status" AS ENUM('idle', 'queued', 'running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."ci_status" AS ENUM('pending', 'passing', 'failing', 'error', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."merge_status" AS ENUM('clean', 'conflicts', 'behind', 'blocked', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('pending', 'approved', 'changes_requested', 'commented', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."pull_request_trigger_status" AS ENUM('pending', 'processing', 'completed', 'superseded', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."pull_request_trigger_type" AS ENUM('ci_failure', 'review_comment', 'review', 'label', 'comment');--> statement-breakpoint
CREATE TABLE "agent_checkpoint" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" text NOT NULL,
	"run_id" text NOT NULL,
	"turn" integer NOT NULL,
	"tokens_used" integer DEFAULT 0 NOT NULL,
	"tool_calls_executed" integer DEFAULT 0 NOT NULL,
	"conversation" jsonb NOT NULL,
	"truncated" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analysis_architecture" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "analysis_architecture_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"workspace_id" integer NOT NULL,
	"project_id" integer NOT NULL,
	"current_version_number" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analysis_architecture_version" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "analysis_architecture_version_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"architecture_id" integer NOT NULL,
	"version_number" integer NOT NULL,
	"pipeline_run_id" text,
	"content" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analysis_capability" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "analysis_capability_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"workspace_id" integer NOT NULL,
	"project_id" integer NOT NULL,
	"capability_key" text NOT NULL,
	"current_version_number" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analysis_capability_version" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "analysis_capability_version_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"capability_id" integer NOT NULL,
	"version_number" integer NOT NULL,
	"pipeline_run_id" text,
	"capability_key" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"technical_details" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analysis_connected_repo" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "analysis_connected_repo_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"workspace_id" integer NOT NULL,
	"project_id" integer NOT NULL,
	"name" text NOT NULL,
	"current_version_number" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analysis_connected_repo_version" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "analysis_connected_repo_version_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"connected_repo_id" integer NOT NULL,
	"version_number" integer NOT NULL,
	"pipeline_run_id" text,
	"content" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analysis_context" (
	"workflow_id" text PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"pipeline_id" uuid,
	"pipeline_slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analysis_context_artifact" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "analysis_context_artifact_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"uuid" uuid DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" integer NOT NULL,
	"project_id" integer NOT NULL,
	"originating_prompt" text NOT NULL,
	"originating_session_id" text,
	"content" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analysis_context_artifact_uuid_unique" UNIQUE("uuid")
);
--> statement-breakpoint
CREATE TABLE "analysis_dependency" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "analysis_dependency_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"workspace_id" integer NOT NULL,
	"project_id" integer NOT NULL,
	"current_version_number" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analysis_dependency_version" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "analysis_dependency_version_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"dependency_id" integer NOT NULL,
	"version_number" integer NOT NULL,
	"pipeline_run_id" text,
	"content" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analysis_deployment_context" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "analysis_deployment_context_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"workspace_id" integer NOT NULL,
	"project_id" integer NOT NULL,
	"name" text NOT NULL,
	"current_version_number" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analysis_deployment_context_version" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "analysis_deployment_context_version_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"deployment_context_id" integer NOT NULL,
	"version_number" integer NOT NULL,
	"pipeline_run_id" text,
	"name" text NOT NULL,
	"environment" text NOT NULL,
	"infrastructure" text NOT NULL,
	"services" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analysis_diagram" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "analysis_diagram_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"workspace_id" integer NOT NULL,
	"project_id" integer NOT NULL,
	"current_version_number" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analysis_diagram_version" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "analysis_diagram_version_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"diagram_id" integer NOT NULL,
	"version_number" integer NOT NULL,
	"pipeline_run_id" text,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analysis_etiquette" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "analysis_etiquette_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"workspace_id" integer NOT NULL,
	"project_id" integer NOT NULL,
	"current_version_number" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analysis_etiquette_version" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "analysis_etiquette_version_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"etiquette_id" integer NOT NULL,
	"version_number" integer NOT NULL,
	"pipeline_run_id" text,
	"content" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analysis_external_integration" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "analysis_external_integration_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"workspace_id" integer NOT NULL,
	"project_id" integer NOT NULL,
	"name" text NOT NULL,
	"current_version_number" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analysis_external_integration_version" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "analysis_external_integration_version_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"external_integration_id" integer NOT NULL,
	"version_number" integer NOT NULL,
	"pipeline_run_id" text,
	"name" text NOT NULL,
	"integration_type" text NOT NULL,
	"purpose" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analysis_feature" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "analysis_feature_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"workspace_id" integer NOT NULL,
	"project_id" integer NOT NULL,
	"feature_key" text NOT NULL,
	"current_version_number" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analysis_feature_version" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "analysis_feature_version_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"feature_id" integer NOT NULL,
	"version_number" integer NOT NULL,
	"pipeline_run_id" text,
	"feature_key" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"category" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analysis_intra_dependency" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "analysis_intra_dependency_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"workspace_id" integer NOT NULL,
	"project_id" integer NOT NULL,
	"current_version_number" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analysis_intra_dependency_version" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "analysis_intra_dependency_version_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"intra_dependency_id" integer NOT NULL,
	"version_number" integer NOT NULL,
	"pipeline_run_id" text,
	"content" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analysis_layer" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "analysis_layer_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"workspace_id" integer NOT NULL,
	"project_id" integer NOT NULL,
	"name" text NOT NULL,
	"current_version_number" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analysis_layer_version" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "analysis_layer_version_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"layer_id" integer NOT NULL,
	"version_number" integer NOT NULL,
	"pipeline_run_id" text,
	"name" text NOT NULL,
	"purpose" text NOT NULL,
	"components" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analysis_project_summary" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "analysis_project_summary_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"workspace_id" integer NOT NULL,
	"project_id" integer NOT NULL,
	"current_version_number" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analysis_project_summary_version" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "analysis_project_summary_version_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"project_summary_id" integer NOT NULL,
	"version_number" integer NOT NULL,
	"pipeline_run_id" text,
	"content" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analysis_run_repository" (
	"workflow_id" text NOT NULL,
	"repository_id" bigint NOT NULL,
	"uri" text NOT NULL,
	"installation_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analysis_run_repository_workflow_id_repository_id_pk" PRIMARY KEY("workflow_id","repository_id")
);
--> statement-breakpoint
CREATE TABLE "analysis_setup" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "analysis_setup_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"workspace_id" integer NOT NULL,
	"project_id" integer NOT NULL,
	"current_version_number" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analysis_setup_version" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "analysis_setup_version_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"setup_id" integer NOT NULL,
	"version_number" integer NOT NULL,
	"pipeline_run_id" text,
	"content" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analysis_ux" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "analysis_ux_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"workspace_id" integer NOT NULL,
	"project_id" integer NOT NULL,
	"current_version_number" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analysis_ux_version" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "analysis_ux_version_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"ux_id" integer NOT NULL,
	"version_number" integer NOT NULL,
	"pipeline_run_id" text,
	"content" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "answer" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "answer_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"question_id" integer NOT NULL,
	"current_version_id" integer,
	"free_form_answer" text,
	"selected_option_id" text,
	"custom_answer" text,
	"created_by_user_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "answer_version" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "answer_version_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"answer_id" integer NOT NULL,
	"question_id" integer NOT NULL,
	"version_number" integer NOT NULL,
	"free_form_answer" text,
	"selected_option_id" text,
	"custom_answer" text,
	"change_reason" text,
	"created_by_user_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_account" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "auth_account_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"provider" "auth_provider" NOT NULL,
	"provider_user_id" text NOT NULL,
	"provider_username" text,
	"email" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claude_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" text,
	"session_id" text NOT NULL,
	"project_path" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "draft_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" text NOT NULL,
	"phase_id" text NOT NULL,
	"version" text NOT NULL,
	"triggered_by" "draft_triggered_by" NOT NULL,
	"feedback" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "flow" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "flow_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"uuid" text NOT NULL,
	"workspace_id" integer NOT NULL,
	"type" "flow_type" NOT NULL,
	"status" "flow_status" DEFAULT 'active' NOT NULL,
	"start_event_uuid" text,
	"end_event_uuid" text,
	"consolidate_to_uuid" text,
	"prd_id" integer,
	"summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "flow_uuid_unique" UNIQUE("uuid")
);
--> statement-breakpoint
CREATE TABLE "github_installation" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "github_installation_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"installation_id" bigint NOT NULL,
	"account_login" text NOT NULL,
	"account_type" "github_account_type" NOT NULL,
	"account_id" bigint NOT NULL,
	"account_avatar_url" text,
	"repository_selection" "repository_selection" NOT NULL,
	"status" "github_installation_status" DEFAULT 'active' NOT NULL,
	"status_reason" text,
	"last_synced_at" timestamp,
	"sync_status" "sync_status" DEFAULT 'idle' NOT NULL,
	"sync_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "github_installation_installation_id_unique" UNIQUE("installation_id")
);
--> statement-breakpoint
CREATE TABLE "github_installation_repository" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "github_installation_repository_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"installation_id" bigint NOT NULL,
	"repository_id" bigint NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"added_at" timestamp DEFAULT now() NOT NULL,
	"removed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "github_webhook_delivery" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "github_webhook_delivery_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"delivery_id" text NOT NULL,
	"event_type" text NOT NULL,
	"processed_at" timestamp DEFAULT now() NOT NULL,
	"installation_id" bigint
);
--> statement-breakpoint
CREATE TABLE "goal" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "goal_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"uuid" text DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" integer NOT NULL,
	"project_id" integer,
	"repository_id" bigint,
	"parent_goal_id" integer,
	"title" text NOT NULL,
	"description" text,
	"status" "goal_status" DEFAULT 'draft' NOT NULL,
	"goal_workflow_phase" "goal_workflow_phase" DEFAULT 'created',
	"scope" "goal_scope",
	"intents" jsonb DEFAULT '[]'::jsonb,
	"domains" jsonb DEFAULT '[]'::jsonb,
	"current_version_number" integer DEFAULT 1 NOT NULL,
	"originating_prompt" text,
	"originating_session_id" text,
	"created_by_user_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "goal_uuid_unique" UNIQUE("uuid")
);
--> statement-breakpoint
CREATE TABLE "goal_version" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "goal_version_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"goal_id" integer NOT NULL,
	"version_number" integer NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" "goal_status" NOT NULL,
	"uuid" text,
	"goal_workflow_phase" "goal_workflow_phase",
	"scope" "goal_scope",
	"intents" jsonb,
	"domains" jsonb,
	"project_id" integer,
	"repository_id" bigint,
	"project_handle" text,
	"repository_full_name" text,
	"parent_goal_id" integer,
	"originating_prompt" text,
	"originating_session_id" text,
	"change_reason" text,
	"created_by_user_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goal_capability" (
	"goal_id" integer NOT NULL,
	"capability_id" integer NOT NULL,
	CONSTRAINT "goal_capability_goal_id_capability_id_pk" PRIMARY KEY("goal_id","capability_id")
);
--> statement-breakpoint
CREATE TABLE "goal_connection" (
	"goal_id" integer NOT NULL,
	"connected_goal_id" integer NOT NULL,
	CONSTRAINT "goal_connection_goal_id_connected_goal_id_pk" PRIMARY KEY("goal_id","connected_goal_id")
);
--> statement-breakpoint
CREATE TABLE "goal_feature" (
	"goal_id" integer NOT NULL,
	"feature_id" integer NOT NULL,
	CONSTRAINT "goal_feature_goal_id_feature_id_pk" PRIMARY KEY("goal_id","feature_id")
);
--> statement-breakpoint
CREATE TABLE "goal_layer" (
	"goal_id" integer NOT NULL,
	"layer_id" integer NOT NULL,
	CONSTRAINT "goal_layer_goal_id_layer_id_pk" PRIMARY KEY("goal_id","layer_id")
);
--> statement-breakpoint
CREATE TABLE "integration_audit_log" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "integration_audit_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"workspace_id" integer NOT NULL,
	"provider" "integration_provider" NOT NULL,
	"event" "integration_audit_event" NOT NULL,
	"actor_user_id" integer,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "linear_comment" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "linear_comment_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"project_id" integer NOT NULL,
	"issue_id" integer NOT NULL,
	"linear_id" text NOT NULL,
	"body" text NOT NULL,
	"user_id" text,
	"user_name" text,
	"raw_json" text NOT NULL,
	"linear_created_at" timestamp,
	"linear_updated_at" timestamp NOT NULL,
	"synced_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "linear_issue" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "linear_issue_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"project_id" integer NOT NULL,
	"team_id" integer NOT NULL,
	"linear_project_id" integer,
	"linear_id" text NOT NULL,
	"identifier" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"priority" integer,
	"priority_label" text,
	"state_id" text,
	"state_name" text,
	"state_type" text,
	"assignee_id" text,
	"assignee_name" text,
	"creator_id" text,
	"due_date" timestamp,
	"estimate" numeric(5, 2),
	"url" text NOT NULL,
	"raw_json" text NOT NULL,
	"linear_created_at" timestamp,
	"linear_updated_at" timestamp NOT NULL,
	"synced_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "linear_issue_label" (
	"issue_id" integer NOT NULL,
	"label_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "linear_issue_label_issue_id_label_id_pk" PRIMARY KEY("issue_id","label_id")
);
--> statement-breakpoint
CREATE TABLE "linear_label" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "linear_label_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"project_id" integer NOT NULL,
	"team_id" integer,
	"linear_id" text NOT NULL,
	"name" text NOT NULL,
	"color" text,
	"description" text,
	"is_group" boolean DEFAULT false,
	"parent_id" text,
	"raw_json" text NOT NULL,
	"synced_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "linear_project" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "linear_project_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"project_id" integer NOT NULL,
	"team_id" integer NOT NULL,
	"linear_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"state" text,
	"progress" numeric(5, 4),
	"target_date" timestamp,
	"raw_json" text NOT NULL,
	"synced_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "linear_project_repo_mapping" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "linear_project_repo_mapping_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"project_id" integer NOT NULL,
	"linear_project_id" integer NOT NULL,
	"repository_id" bigint NOT NULL,
	"branch_override" text,
	"trigger_on_statuses" text[] DEFAULT '{}' NOT NULL,
	"trigger_on_labels" text[] DEFAULT '{}' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "linear_team" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "linear_team_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"project_id" integer NOT NULL,
	"linear_id" text NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"color" text,
	"icon" text,
	"raw_json" text NOT NULL,
	"synced_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "linear_webhook" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "linear_webhook_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"workspace_integration_id" integer NOT NULL,
	"linear_webhook_id" text NOT NULL,
	"secret" text NOT NULL,
	"team_id" text,
	"all_public_teams" boolean DEFAULT false NOT NULL,
	"resource_types" text[] NOT NULL,
	"label" text,
	"url" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "linear_webhook_delivery" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "linear_webhook_delivery_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"delivery_id" text NOT NULL,
	"resource_type" text NOT NULL,
	"action" text NOT NULL,
	"resource_id" text NOT NULL,
	"workspace_integration_id" integer,
	"processed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_connection" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "oauth_connection_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"provider" "oauth_provider" NOT NULL,
	"provider_user_id" text NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text,
	"expires_at" timestamp,
	"scope" text,
	"status" "oauth_status" DEFAULT 'active',
	"last_checked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pipeline_output_schema" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"json_schema" jsonb NOT NULL,
	"is_built_in" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pipeline_output_schema_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "phase_execution" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" text NOT NULL,
	"phase_id" text NOT NULL,
	"status" "phase_execution_status" NOT NULL,
	"is_draftable" boolean DEFAULT false NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"session_id" text,
	"artifact_path" text,
	"draft_state" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "phase_template" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" "phase_template_category" NOT NULL,
	"default_prompt" text NOT NULL,
	"prompt_prefix" text,
	"prompt_suffix" text,
	"output_schema" jsonb,
	"file_extension" text DEFAULT 'json' NOT NULL,
	"output_context" text,
	"default_populates_field" text,
	"has_custom_execute" boolean DEFAULT false NOT NULL,
	"is_built_in" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "phase_template_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "pipeline" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"pipeline_output_schema_id" uuid,
	"phases" jsonb NOT NULL,
	"groups" jsonb,
	"exports" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"input_schema" jsonb,
	"field_mapping" jsonb,
	"is_built_in" boolean DEFAULT false NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pipeline_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "pipeline_artifact" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" text NOT NULL,
	"phase_id" text NOT NULL,
	"version" text DEFAULT '1' NOT NULL,
	"content" text NOT NULL,
	"file_extension" text DEFAULT 'json' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "plan_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"workflow_id" text NOT NULL,
	"goal_id" integer NOT NULL,
	"project_id" integer NOT NULL,
	"result" text,
	"status" "workflow_execution_status" DEFAULT 'pending' NOT NULL,
	"error" text,
	"started_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "prd" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "prd_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"uuid" text NOT NULL,
	"workspace_id" integer NOT NULL,
	"project_id" integer,
	"repository_id" bigint,
	"goal_id" integer,
	"title" text NOT NULL,
	"summary" text,
	"ux" text,
	"goals" jsonb DEFAULT '[]'::jsonb,
	"affected_fnc" jsonb DEFAULT '[]'::jsonb,
	"assumptions" jsonb DEFAULT '[]'::jsonb,
	"notes" jsonb DEFAULT '[]'::jsonb,
	"status" "document_status" DEFAULT 'draft' NOT NULL,
	"approved" boolean DEFAULT false,
	"version_number" integer DEFAULT 1 NOT NULL,
	"revised_from_prd_id" integer,
	"originating_prompt" text,
	"originating_session_id" text,
	"artifact_id" integer,
	"created_by_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prd_uuid_unique" UNIQUE("uuid")
);
--> statement-breakpoint
CREATE TABLE "pipeline_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" text NOT NULL,
	"pipeline_id" uuid,
	"status" "pipeline_run_status" NOT NULL,
	"input" jsonb NOT NULL,
	"output" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	CONSTRAINT "pipeline_run_workflow_id_unique" UNIQUE("workflow_id")
);
--> statement-breakpoint
CREATE TABLE "project_analysis" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "project_analysis_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"workflow_id" text NOT NULL,
	"project_id" integer NOT NULL,
	"result" text,
	"status" "workflow_execution_status" DEFAULT 'pending' NOT NULL,
	"error" text,
	"started_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "platform_admin_audit_log" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "platform_admin_audit_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"performed_by" integer,
	"action" "platform_admin_action" NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pull_request_state" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "pull_request_state_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"repository_id" bigint NOT NULL,
	"pr_number" integer NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"is_draft" boolean DEFAULT false NOT NULL,
	"is_merged" boolean DEFAULT false NOT NULL,
	"head_sha" text,
	"base_sha" text,
	"base_ref" text,
	"ci_status" "ci_status" DEFAULT 'unknown' NOT NULL,
	"failing_check_count" integer DEFAULT 0 NOT NULL,
	"ci_updated_at" timestamp,
	"review_status" "review_status" DEFAULT 'unknown' NOT NULL,
	"approval_count" integer DEFAULT 0 NOT NULL,
	"changes_requested_count" integer DEFAULT 0 NOT NULL,
	"unresolved_thread_count" integer DEFAULT 0 NOT NULL,
	"review_updated_at" timestamp,
	"merge_status" "merge_status" DEFAULT 'unknown' NOT NULL,
	"merge_updated_at" timestamp,
	"automation_status" "automation_status" DEFAULT 'idle' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_error_message" text,
	"last_trigger_signature" text,
	"signature_attempt_count" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp,
	"is_paused" boolean DEFAULT false NOT NULL,
	"pr_updated_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pull_request_trigger" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "pull_request_trigger_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"repository_id" bigint NOT NULL,
	"pr_number" integer NOT NULL,
	"trigger_type" "pull_request_trigger_type" NOT NULL,
	"head_sha" text NOT NULL,
	"signature" text NOT NULL,
	"installation_id" bigint NOT NULL,
	"workspace_id" integer NOT NULL,
	"status" "pull_request_trigger_status" DEFAULT 'pending' NOT NULL,
	"orchestrator_workflow_id" text,
	"child_workflow_id" text,
	"triggered_by_user_id" integer,
	"trigger_actor_login" text,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "project_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"workspace_id" integer NOT NULL,
	"name" text NOT NULL,
	"display_name" text NOT NULL,
	"handle" text NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_handle_lowercase" CHECK (handle = lower(handle)),
	CONSTRAINT "project_handle_not_reserved" CHECK (handle NOT IN (
        'new', 'create', 'edit', 'delete', 'update', 'remove',
        'settings', 'goals', 'questions', 'analysis', 'activity', 'analytics', 'files', 'branches',
        'commits', 'pulls', 'pull-requests', 'issues', 'releases', 'deployments',
        'environments', 'webhooks', 'api', 'export', 'archive', 'danger',
        'repositories', 'github', 'linear', 'admin', 'null', 'undefined'
      ))
);
--> statement-breakpoint
CREATE TABLE "project_linear_settings" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "project_linear_settings_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"project_id" integer NOT NULL,
	"linear_team_id" text NOT NULL,
	"linear_project_id" text,
	"default_label_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"default_state_id" text,
	"default_template_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_repository" (
	"project_id" integer NOT NULL,
	"repository_id" bigint NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_repository_project_id_repository_id_pk" PRIMARY KEY("project_id","repository_id")
);
--> statement-breakpoint
CREATE TABLE "question" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "question_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"workspace_id" integer NOT NULL,
	"project_id" integer,
	"repository_id" bigint,
	"goal_id" integer,
	"prd_id" integer,
	"technical_spec_id" integer,
	"question_text" text NOT NULL,
	"description" text,
	"type" "question_type" NOT NULL,
	"options" jsonb,
	"allow_custom_answer" boolean DEFAULT false NOT NULL,
	"option_order" "question_option_order" DEFAULT 'manual' NOT NULL,
	"status" "question_status" DEFAULT 'draft' NOT NULL,
	"created_by_user_id" integer,
	"idempotency_key" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "question_scope_exactly_one" CHECK ((case when "question"."project_id" is null then 0 else 1 end)
        + (case when "question"."repository_id" is null then 0 else 1 end)
        + (case when "question"."goal_id" is null then 0 else 1 end)
        + (case when "question"."prd_id" is null then 0 else 1 end)
        + (case when "question"."technical_spec_id" is null then 0 else 1 end) = 1)
);
--> statement-breakpoint
CREATE TABLE "repository" (
	"id" bigint PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"name" text NOT NULL,
	"uri" text,
	"default_branch" text,
	"commit" text,
	"installation_id" bigint,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sandbox_lifecycle_event" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sandbox_lifecycle_event_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"delivery_id" text NOT NULL,
	"sandbox_id" text NOT NULL,
	"execution_id" text,
	"template_id" text,
	"build_id" text,
	"event_type" text NOT NULL,
	"event_timestamp" timestamp with time zone NOT NULL,
	"workspace_id" integer NOT NULL,
	"project_id" integer NOT NULL,
	"repository_id" integer NOT NULL,
	"goal_id" integer,
	"user_id" integer,
	"payload" jsonb NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sandbox_lifecycle_snapshot" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sandbox_lifecycle_snapshot_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"sandbox_id" text NOT NULL,
	"execution_id" text,
	"template_id" text,
	"build_id" text,
	"workspace_id" integer NOT NULL,
	"project_id" integer NOT NULL,
	"repository_id" integer NOT NULL,
	"goal_id" integer,
	"user_id" integer,
	"total_events" integer DEFAULT 0 NOT NULL,
	"created_count" integer DEFAULT 0 NOT NULL,
	"updated_count" integer DEFAULT 0 NOT NULL,
	"paused_count" integer DEFAULT 0 NOT NULL,
	"resumed_count" integer DEFAULT 0 NOT NULL,
	"killed_count" integer DEFAULT 0 NOT NULL,
	"first_event_at" timestamp with time zone NOT NULL,
	"last_event_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_event" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "session_event_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"workspace_id" integer NOT NULL,
	"project_id" integer,
	"session_id" text NOT NULL,
	"uuid" text NOT NULL,
	"parent_uuid" text,
	"event_type" text NOT NULL,
	"subtype" "session_event_subtype" NOT NULL,
	"content" jsonb NOT NULL,
	"cwd" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_event_uuid_unique" UNIQUE("uuid")
);
--> statement-breakpoint
CREATE TABLE "service_account" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "service_account_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"service_id" varchar(64) NOT NULL,
	"display_name" varchar(255) NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "service_account_service_id_unique" UNIQUE("service_id"),
	CONSTRAINT "service_account_service_id_format" CHECK (service_id ~ '^[a-z0-9-]{1,64}$')
);
--> statement-breakpoint
CREATE TABLE "service_audit_log" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "service_audit_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"service_account_id" integer,
	"service_key_id" integer,
	"attempted_service_id" varchar(64),
	"attempted_key_prefix" varchar(15),
	"action" varchar(64) NOT NULL,
	"procedure_path" varchar(255),
	"ip_address" varchar(45),
	"user_agent" text,
	"correlation_id" varchar(64),
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_key" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "service_key_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"service_account_id" integer NOT NULL,
	"key_hash" varchar(64) NOT NULL,
	"key_prefix" varchar(15) NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"expires_at" timestamp,
	"revoked_at" timestamp,
	"last_used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "service_key_key_prefix_unique" UNIQUE("key_prefix"),
	CONSTRAINT "service_key_prefix_format" CHECK (key_prefix ~ '^sk_[0-9a-f]{12}$')
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"expires_at" timestamp NOT NULL,
	"last_auth_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "task_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"uuid" text NOT NULL,
	"workspace_id" integer NOT NULL,
	"technical_spec_id" integer NOT NULL,
	"title" text NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb,
	"status" "task_status" DEFAULT 'pending' NOT NULL,
	"created_by_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_uuid_unique" UNIQUE("uuid")
);
--> statement-breakpoint
CREATE TABLE "task_dependency" (
	"task_id" integer NOT NULL,
	"depends_on_task_id" integer NOT NULL,
	CONSTRAINT "task_dependency_task_id_depends_on_task_id_pk" PRIMARY KEY("task_id","depends_on_task_id")
);
--> statement-breakpoint
CREATE TABLE "technical_spec" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "technical_spec_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"uuid" text NOT NULL,
	"workspace_id" integer NOT NULL,
	"project_id" integer,
	"repository_id" bigint,
	"prd_id" integer,
	"title" text NOT NULL,
	"summary" text,
	"diagram" text,
	"architecture_changes" jsonb,
	"type_changes" jsonb DEFAULT '[]'::jsonb,
	"file_changes" jsonb DEFAULT '[]'::jsonb,
	"api_changes" jsonb DEFAULT '[]'::jsonb,
	"implementation_steps" jsonb DEFAULT '[]'::jsonb,
	"extra_text" text,
	"notes" jsonb DEFAULT '[]'::jsonb,
	"status" "document_status" DEFAULT 'draft' NOT NULL,
	"approved" boolean DEFAULT false,
	"version_number" integer DEFAULT 1 NOT NULL,
	"revised_from_technical_spec_id" integer,
	"originating_prompt" text,
	"originating_session_id" text,
	"artifact_id" integer,
	"created_by_user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "technical_spec_uuid_unique" UNIQUE("uuid")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "user_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"username" text NOT NULL,
	"email" text,
	"name" text,
	"avatar_url" text,
	"is_platform_admin" boolean DEFAULT false NOT NULL,
	CONSTRAINT "user_username_format" CHECK ("user"."username" ~ '^[a-z0-9][a-z0-9-]{1,37}[a-z0-9]$' OR "user"."username" ~ '^[a-z0-9]{3}$'),
	CONSTRAINT "user_username_not_reserved" CHECK (lower("user"."username") NOT IN (
        'admin', 'administrator', 'root', 'system', 'support', 'help',
        'api', 'www', 'app', 'auth', 'oauth', 'callback', 'login', 'logout', 'signup', 'signin', 'register', 'settings', 'dashboard', 'profile', 'account', 'user', 'users',
        'mail', 'email', 'billing', 'payments', 'docs', 'blog', 'status', 'cdn', 'static', 'assets',
        'tribunal', 'about', 'team', 'legal', 'privacy', 'terms', 'contact',
        'new', 'create', 'edit', 'delete', 'workspace', 'workspaces', 'project', 'projects', 'invitation', 'invitations', 'connection', 'connections', 'connect', 'member', 'members', 'security', 'onboarding', 'reauth', 'link', 'unlink'
      ))
);
--> statement-breakpoint
CREATE TABLE "user_api_key" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "user_api_key_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"key_hash" varchar(64) NOT NULL,
	"key_prefix" varchar(16) NOT NULL,
	"expires_at" timestamp,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_api_key_key_prefix_unique" UNIQUE("key_prefix"),
	CONSTRAINT "user_api_key_prefix_format" CHECK (key_prefix ~ '^uak_[0-9a-f]{12}$'),
	CONSTRAINT "user_api_key_name_not_empty" CHECK (length(trim("user_api_key"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "webhook_event" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "webhook_event_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"event_type" text NOT NULL,
	"action" text,
	"delivery_id" text,
	"payload" text NOT NULL,
	"repository_id" bigint NOT NULL,
	"installation_id" bigint,
	"sender_id" bigint,
	"sender_login" text,
	"pr_number" integer,
	"issue_number" integer,
	"ref" text,
	"commit_sha" text,
	"github_created_at" timestamp,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_event_delivery_id_unique" UNIQUE("delivery_id")
);
--> statement-breakpoint
CREATE TABLE "workflow_config" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "workflow_config_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"workspace_id" integer NOT NULL,
	"max_concurrent_workflows" integer DEFAULT 3 NOT NULL,
	"workflow_timeout_minutes" integer DEFAULT 30 NOT NULL,
	"agent_turn_limit" integer DEFAULT 50 NOT NULL,
	"token_budget_per_workflow" integer DEFAULT 100000 NOT NULL,
	"max_tool_calls" integer DEFAULT 200 NOT NULL,
	"max_files_modified" integer DEFAULT 50 NOT NULL,
	"validation_command" text,
	"validation_timeout_minutes" integer DEFAULT 5 NOT NULL,
	"auto_trigger_on_review" boolean DEFAULT false NOT NULL,
	"require_approval_for_implementation" boolean DEFAULT true NOT NULL,
	"push_conflict_policy" "push_conflict_policy" DEFAULT 'abort' NOT NULL,
	"pr_assist_enabled" boolean DEFAULT false NOT NULL,
	"allow_draft_prs" boolean DEFAULT false NOT NULL,
	"auto_resolve_review_threads" boolean DEFAULT false NOT NULL,
	"resolve_confidence_threshold" numeric(3, 2) DEFAULT '0.80' NOT NULL,
	"attempt_limit_per_pr" integer DEFAULT 5 NOT NULL,
	"attempt_limit_per_signature" integer DEFAULT 2 NOT NULL,
	"backoff_base_minutes" integer DEFAULT 5 NOT NULL,
	"branch_update_strategy" "branch_update_strategy" DEFAULT 'merge' NOT NULL,
	"retention_days" integer DEFAULT 90 NOT NULL,
	"auto_delete_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_config_workspace_id_unique" UNIQUE("workspace_id"),
	CONSTRAINT "workflow_config_timeout_range" CHECK ("workflow_config"."workflow_timeout_minutes" >= 1 AND "workflow_config"."workflow_timeout_minutes" <= 60),
	CONSTRAINT "workflow_config_turn_limit_range" CHECK ("workflow_config"."agent_turn_limit" >= 1 AND "workflow_config"."agent_turn_limit" <= 100),
	CONSTRAINT "workflow_config_token_budget_range" CHECK ("workflow_config"."token_budget_per_workflow" >= 1000 AND "workflow_config"."token_budget_per_workflow" <= 500000),
	CONSTRAINT "workflow_config_tool_calls_range" CHECK ("workflow_config"."max_tool_calls" >= 10 AND "workflow_config"."max_tool_calls" <= 500),
	CONSTRAINT "workflow_config_files_modified_range" CHECK ("workflow_config"."max_files_modified" >= 1 AND "workflow_config"."max_files_modified" <= 100),
	CONSTRAINT "workflow_config_validation_timeout_range" CHECK ("workflow_config"."validation_timeout_minutes" >= 1 AND "workflow_config"."validation_timeout_minutes" <= 10),
	CONSTRAINT "workflow_config_concurrent_range" CHECK ("workflow_config"."max_concurrent_workflows" >= 1 AND "workflow_config"."max_concurrent_workflows" <= 10),
	CONSTRAINT "workflow_config_retention_days_range" CHECK ("workflow_config"."retention_days" >= 1 AND "workflow_config"."retention_days" <= 3650),
	CONSTRAINT "workflow_config_attempt_limit_per_pr_range" CHECK ("workflow_config"."attempt_limit_per_pr" >= 1 AND "workflow_config"."attempt_limit_per_pr" <= 50),
	CONSTRAINT "workflow_config_attempt_limit_per_signature_range" CHECK ("workflow_config"."attempt_limit_per_signature" >= 1 AND "workflow_config"."attempt_limit_per_signature" <= 10),
	CONSTRAINT "workflow_config_backoff_base_minutes_range" CHECK ("workflow_config"."backoff_base_minutes" >= 1 AND "workflow_config"."backoff_base_minutes" <= 60)
);
--> statement-breakpoint
CREATE TABLE "workflow_issue_reference" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "workflow_issue_reference_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"workflow_run_id" uuid NOT NULL,
	"type" "issue_reference_type" NOT NULL,
	"issue_id" text NOT NULL,
	"issue_key" text,
	"issue_url" text,
	"title" text,
	"status" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" text NOT NULL,
	"run_id" text,
	"workspace_id" integer NOT NULL,
	"repository_id" bigint,
	"pull_request_number" integer,
	"task_type" "workflow_task_type" NOT NULL,
	"trigger_source" text NOT NULL,
	"trigger_metadata" jsonb,
	"phase" "workflow_phase" DEFAULT 'pending' NOT NULL,
	"template_alias" text,
	"template_id" text,
	"envd_version" text,
	"files_changed" text[],
	"commit_sha" text,
	"tokens_used" integer DEFAULT 0,
	"cost_usd" numeric(10, 4) DEFAULT '0',
	"error_message" text,
	"error_category" "error_category",
	"error_code" text,
	"retry_of_workflow_id" text,
	"commits" jsonb,
	"validation_warning" boolean DEFAULT false,
	"resolution_artifact" jsonb,
	"artifacts" jsonb,
	"trigger_actor_id" bigint,
	"trigger_actor_login" text,
	"triggered_by_user_id" integer,
	"cancellation_reason" text,
	"orchestrator_workflow_id" text,
	"trigger_id" integer,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "workspace_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"handle" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_handle_unique" UNIQUE("handle"),
	CONSTRAINT "workspace_handle_lowercase" CHECK (handle = lower(handle)),
	CONSTRAINT "workspace_handle_format" CHECK (handle ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$' OR handle ~ '^[a-z0-9]$'),
	CONSTRAINT "workspace_handle_not_reserved" CHECK (handle NOT IN (
        'new', 'create', 'edit', 'delete', 'update', 'remove',
        'settings', 'projects', 'connections', 'members', 'workflows',
        'billing', 'activity', 'analytics', 'integrations', 'webhooks',
        'api', 'export', 'import', 'archive', 'audit', 'danger', 'notifications',
        'admin', 'null', 'undefined', 'me'
      ))
);
--> statement-breakpoint
CREATE TABLE "workspace_github_installation" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "workspace_github_installation_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"workspace_id" integer NOT NULL,
	"installation_id" bigint NOT NULL,
	"connected_by_user_id" integer,
	"connected_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_credential" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "integration_credential_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"workspace_integration_id" integer NOT NULL,
	"provider" "integration_provider" NOT NULL,
	"role" "credential_role" DEFAULT 'app_actor' NOT NULL,
	"actor" "oauth_actor",
	"external_subject_id" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"credential_type" "credential_type" DEFAULT 'oauth' NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"token_expires_at" timestamp,
	"scopes" text[],
	"service_account_json" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_integration" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "workspace_integration_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"workspace_id" integer NOT NULL,
	"provider" "integration_provider" NOT NULL,
	"status" "integration_status" DEFAULT 'active' NOT NULL,
	"status_reason" text,
	"connected_by_user_id" integer,
	"provider_account_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_integration_resource" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "workspace_integration_resource_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"workspace_integration_id" integer NOT NULL,
	"resource_type" "resource_type" NOT NULL,
	"external_id" text NOT NULL,
	"display_name" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_invitation" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "workspace_invitation_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"workspace_id" integer NOT NULL,
	"inviter_user_id" integer NOT NULL,
	"invitee_email" text NOT NULL,
	"role" "workspace_role" NOT NULL,
	"token_hash" text NOT NULL,
	"status" "invitation_status" DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"accepted_by_user_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_invitation_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "workspace_membership" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "workspace_membership_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"workspace_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"role" "workspace_role" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "analysis_architecture" ADD CONSTRAINT "analysis_architecture_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_architecture" ADD CONSTRAINT "analysis_architecture_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_architecture_version" ADD CONSTRAINT "analysis_architecture_version_architecture_id_analysis_architecture_id_fk" FOREIGN KEY ("architecture_id") REFERENCES "public"."analysis_architecture"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_architecture_version" ADD CONSTRAINT "analysis_architecture_version_pipeline_run_id_pipeline_run_workflow_id_fk" FOREIGN KEY ("pipeline_run_id") REFERENCES "public"."pipeline_run"("workflow_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_capability" ADD CONSTRAINT "analysis_capability_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_capability" ADD CONSTRAINT "analysis_capability_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_capability_version" ADD CONSTRAINT "analysis_capability_version_capability_id_analysis_capability_id_fk" FOREIGN KEY ("capability_id") REFERENCES "public"."analysis_capability"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_capability_version" ADD CONSTRAINT "analysis_capability_version_pipeline_run_id_pipeline_run_workflow_id_fk" FOREIGN KEY ("pipeline_run_id") REFERENCES "public"."pipeline_run"("workflow_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_connected_repo" ADD CONSTRAINT "analysis_connected_repo_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_connected_repo" ADD CONSTRAINT "analysis_connected_repo_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_connected_repo_version" ADD CONSTRAINT "analysis_connected_repo_version_connected_repo_id_analysis_connected_repo_id_fk" FOREIGN KEY ("connected_repo_id") REFERENCES "public"."analysis_connected_repo"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_connected_repo_version" ADD CONSTRAINT "analysis_connected_repo_version_pipeline_run_id_pipeline_run_workflow_id_fk" FOREIGN KEY ("pipeline_run_id") REFERENCES "public"."pipeline_run"("workflow_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_context" ADD CONSTRAINT "analysis_context_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_context" ADD CONSTRAINT "analysis_context_pipeline_id_pipeline_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipeline"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_context_artifact" ADD CONSTRAINT "analysis_context_artifact_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_context_artifact" ADD CONSTRAINT "analysis_context_artifact_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_dependency" ADD CONSTRAINT "analysis_dependency_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_dependency" ADD CONSTRAINT "analysis_dependency_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_dependency_version" ADD CONSTRAINT "analysis_dependency_version_dependency_id_analysis_dependency_id_fk" FOREIGN KEY ("dependency_id") REFERENCES "public"."analysis_dependency"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_dependency_version" ADD CONSTRAINT "analysis_dependency_version_pipeline_run_id_pipeline_run_workflow_id_fk" FOREIGN KEY ("pipeline_run_id") REFERENCES "public"."pipeline_run"("workflow_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_deployment_context" ADD CONSTRAINT "analysis_deployment_context_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_deployment_context" ADD CONSTRAINT "analysis_deployment_context_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_deployment_context_version" ADD CONSTRAINT "analysis_deployment_context_version_deployment_context_id_analysis_deployment_context_id_fk" FOREIGN KEY ("deployment_context_id") REFERENCES "public"."analysis_deployment_context"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_deployment_context_version" ADD CONSTRAINT "analysis_deployment_context_version_pipeline_run_id_pipeline_run_workflow_id_fk" FOREIGN KEY ("pipeline_run_id") REFERENCES "public"."pipeline_run"("workflow_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_diagram" ADD CONSTRAINT "analysis_diagram_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_diagram" ADD CONSTRAINT "analysis_diagram_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_diagram_version" ADD CONSTRAINT "analysis_diagram_version_diagram_id_analysis_diagram_id_fk" FOREIGN KEY ("diagram_id") REFERENCES "public"."analysis_diagram"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_diagram_version" ADD CONSTRAINT "analysis_diagram_version_pipeline_run_id_pipeline_run_workflow_id_fk" FOREIGN KEY ("pipeline_run_id") REFERENCES "public"."pipeline_run"("workflow_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_etiquette" ADD CONSTRAINT "analysis_etiquette_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_etiquette" ADD CONSTRAINT "analysis_etiquette_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_etiquette_version" ADD CONSTRAINT "analysis_etiquette_version_etiquette_id_analysis_etiquette_id_fk" FOREIGN KEY ("etiquette_id") REFERENCES "public"."analysis_etiquette"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_etiquette_version" ADD CONSTRAINT "analysis_etiquette_version_pipeline_run_id_pipeline_run_workflow_id_fk" FOREIGN KEY ("pipeline_run_id") REFERENCES "public"."pipeline_run"("workflow_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_external_integration" ADD CONSTRAINT "analysis_external_integration_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_external_integration" ADD CONSTRAINT "analysis_external_integration_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_external_integration_version" ADD CONSTRAINT "analysis_external_integration_version_external_integration_id_analysis_external_integration_id_fk" FOREIGN KEY ("external_integration_id") REFERENCES "public"."analysis_external_integration"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_external_integration_version" ADD CONSTRAINT "analysis_external_integration_version_pipeline_run_id_pipeline_run_workflow_id_fk" FOREIGN KEY ("pipeline_run_id") REFERENCES "public"."pipeline_run"("workflow_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_feature" ADD CONSTRAINT "analysis_feature_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_feature" ADD CONSTRAINT "analysis_feature_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_feature_version" ADD CONSTRAINT "analysis_feature_version_feature_id_analysis_feature_id_fk" FOREIGN KEY ("feature_id") REFERENCES "public"."analysis_feature"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_feature_version" ADD CONSTRAINT "analysis_feature_version_pipeline_run_id_pipeline_run_workflow_id_fk" FOREIGN KEY ("pipeline_run_id") REFERENCES "public"."pipeline_run"("workflow_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_intra_dependency" ADD CONSTRAINT "analysis_intra_dependency_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_intra_dependency" ADD CONSTRAINT "analysis_intra_dependency_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_intra_dependency_version" ADD CONSTRAINT "analysis_intra_dependency_version_intra_dependency_id_analysis_intra_dependency_id_fk" FOREIGN KEY ("intra_dependency_id") REFERENCES "public"."analysis_intra_dependency"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_intra_dependency_version" ADD CONSTRAINT "analysis_intra_dependency_version_pipeline_run_id_pipeline_run_workflow_id_fk" FOREIGN KEY ("pipeline_run_id") REFERENCES "public"."pipeline_run"("workflow_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_layer" ADD CONSTRAINT "analysis_layer_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_layer" ADD CONSTRAINT "analysis_layer_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_layer_version" ADD CONSTRAINT "analysis_layer_version_layer_id_analysis_layer_id_fk" FOREIGN KEY ("layer_id") REFERENCES "public"."analysis_layer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_layer_version" ADD CONSTRAINT "analysis_layer_version_pipeline_run_id_pipeline_run_workflow_id_fk" FOREIGN KEY ("pipeline_run_id") REFERENCES "public"."pipeline_run"("workflow_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_project_summary" ADD CONSTRAINT "analysis_project_summary_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_project_summary" ADD CONSTRAINT "analysis_project_summary_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_project_summary_version" ADD CONSTRAINT "analysis_project_summary_version_project_summary_id_analysis_project_summary_id_fk" FOREIGN KEY ("project_summary_id") REFERENCES "public"."analysis_project_summary"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_project_summary_version" ADD CONSTRAINT "analysis_project_summary_version_pipeline_run_id_pipeline_run_workflow_id_fk" FOREIGN KEY ("pipeline_run_id") REFERENCES "public"."pipeline_run"("workflow_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_run_repository" ADD CONSTRAINT "analysis_run_repository_workflow_id_analysis_context_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."analysis_context"("workflow_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_setup" ADD CONSTRAINT "analysis_setup_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_setup" ADD CONSTRAINT "analysis_setup_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_setup_version" ADD CONSTRAINT "analysis_setup_version_setup_id_analysis_setup_id_fk" FOREIGN KEY ("setup_id") REFERENCES "public"."analysis_setup"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_setup_version" ADD CONSTRAINT "analysis_setup_version_pipeline_run_id_pipeline_run_workflow_id_fk" FOREIGN KEY ("pipeline_run_id") REFERENCES "public"."pipeline_run"("workflow_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_ux" ADD CONSTRAINT "analysis_ux_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_ux" ADD CONSTRAINT "analysis_ux_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_ux_version" ADD CONSTRAINT "analysis_ux_version_ux_id_analysis_ux_id_fk" FOREIGN KEY ("ux_id") REFERENCES "public"."analysis_ux"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_ux_version" ADD CONSTRAINT "analysis_ux_version_pipeline_run_id_pipeline_run_workflow_id_fk" FOREIGN KEY ("pipeline_run_id") REFERENCES "public"."pipeline_run"("workflow_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answer" ADD CONSTRAINT "answer_question_id_question_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."question"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answer" ADD CONSTRAINT "answer_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answer_version" ADD CONSTRAINT "answer_version_answer_id_answer_id_fk" FOREIGN KEY ("answer_id") REFERENCES "public"."answer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answer_version" ADD CONSTRAINT "answer_version_question_id_question_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."question"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answer_version" ADD CONSTRAINT "answer_version_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_account" ADD CONSTRAINT "auth_account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claude_session" ADD CONSTRAINT "claude_session_workflow_id_pipeline_run_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."pipeline_run"("workflow_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_version" ADD CONSTRAINT "draft_version_workflow_id_pipeline_run_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."pipeline_run"("workflow_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow" ADD CONSTRAINT "flow_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flow" ADD CONSTRAINT "flow_prd_id_prd_id_fk" FOREIGN KEY ("prd_id") REFERENCES "public"."prd"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_installation_repository" ADD CONSTRAINT "github_installation_repository_installation_id_github_installation_installation_id_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."github_installation"("installation_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_installation_repository" ADD CONSTRAINT "github_installation_repository_repository_id_repository_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repository"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal" ADD CONSTRAINT "goal_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal" ADD CONSTRAINT "goal_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal" ADD CONSTRAINT "goal_repository_id_repository_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repository"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal" ADD CONSTRAINT "goal_parent_goal_id_goal_id_fk" FOREIGN KEY ("parent_goal_id") REFERENCES "public"."goal"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal" ADD CONSTRAINT "goal_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_version" ADD CONSTRAINT "goal_version_goal_id_goal_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_version" ADD CONSTRAINT "goal_version_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_capability" ADD CONSTRAINT "goal_capability_goal_id_goal_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_capability" ADD CONSTRAINT "goal_capability_capability_id_analysis_capability_id_fk" FOREIGN KEY ("capability_id") REFERENCES "public"."analysis_capability"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_connection" ADD CONSTRAINT "goal_connection_goal_id_goal_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_connection" ADD CONSTRAINT "goal_connection_connected_goal_id_goal_id_fk" FOREIGN KEY ("connected_goal_id") REFERENCES "public"."goal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_feature" ADD CONSTRAINT "goal_feature_goal_id_goal_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_feature" ADD CONSTRAINT "goal_feature_feature_id_analysis_feature_id_fk" FOREIGN KEY ("feature_id") REFERENCES "public"."analysis_feature"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_layer" ADD CONSTRAINT "goal_layer_goal_id_goal_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_layer" ADD CONSTRAINT "goal_layer_layer_id_analysis_layer_id_fk" FOREIGN KEY ("layer_id") REFERENCES "public"."analysis_layer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_audit_log" ADD CONSTRAINT "integration_audit_log_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_audit_log" ADD CONSTRAINT "integration_audit_log_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "linear_comment" ADD CONSTRAINT "linear_comment_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "linear_comment" ADD CONSTRAINT "linear_comment_issue_id_linear_issue_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."linear_issue"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "linear_issue" ADD CONSTRAINT "linear_issue_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "linear_issue" ADD CONSTRAINT "linear_issue_team_id_linear_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."linear_team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "linear_issue" ADD CONSTRAINT "linear_issue_linear_project_id_linear_project_id_fk" FOREIGN KEY ("linear_project_id") REFERENCES "public"."linear_project"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "linear_issue_label" ADD CONSTRAINT "linear_issue_label_issue_id_linear_issue_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."linear_issue"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "linear_issue_label" ADD CONSTRAINT "linear_issue_label_label_id_linear_label_id_fk" FOREIGN KEY ("label_id") REFERENCES "public"."linear_label"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "linear_label" ADD CONSTRAINT "linear_label_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "linear_label" ADD CONSTRAINT "linear_label_team_id_linear_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."linear_team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "linear_project" ADD CONSTRAINT "linear_project_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "linear_project" ADD CONSTRAINT "linear_project_team_id_linear_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."linear_team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "linear_project_repo_mapping" ADD CONSTRAINT "linear_project_repo_mapping_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "linear_project_repo_mapping" ADD CONSTRAINT "linear_project_repo_mapping_linear_project_id_linear_project_id_fk" FOREIGN KEY ("linear_project_id") REFERENCES "public"."linear_project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "linear_project_repo_mapping" ADD CONSTRAINT "linear_project_repo_mapping_repository_id_repository_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repository"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "linear_team" ADD CONSTRAINT "linear_team_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "linear_webhook" ADD CONSTRAINT "linear_webhook_workspace_integration_id_workspace_integration_id_fk" FOREIGN KEY ("workspace_integration_id") REFERENCES "public"."workspace_integration"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "linear_webhook_delivery" ADD CONSTRAINT "linear_webhook_delivery_workspace_integration_id_workspace_integration_id_fk" FOREIGN KEY ("workspace_integration_id") REFERENCES "public"."workspace_integration"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_connection" ADD CONSTRAINT "oauth_connection_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phase_execution" ADD CONSTRAINT "phase_execution_workflow_id_pipeline_run_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."pipeline_run"("workflow_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline" ADD CONSTRAINT "pipeline_pipeline_output_schema_id_pipeline_output_schema_id_fk" FOREIGN KEY ("pipeline_output_schema_id") REFERENCES "public"."pipeline_output_schema"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_artifact" ADD CONSTRAINT "pipeline_artifact_workflow_id_pipeline_run_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."pipeline_run"("workflow_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan" ADD CONSTRAINT "plan_goal_id_goal_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan" ADD CONSTRAINT "plan_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prd" ADD CONSTRAINT "prd_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prd" ADD CONSTRAINT "prd_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prd" ADD CONSTRAINT "prd_repository_id_repository_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repository"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prd" ADD CONSTRAINT "prd_goal_id_goal_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goal"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prd" ADD CONSTRAINT "prd_revised_from_prd_id_prd_id_fk" FOREIGN KEY ("revised_from_prd_id") REFERENCES "public"."prd"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prd" ADD CONSTRAINT "prd_artifact_id_analysis_context_artifact_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."analysis_context_artifact"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prd" ADD CONSTRAINT "prd_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_run" ADD CONSTRAINT "pipeline_run_pipeline_id_pipeline_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."pipeline"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_analysis" ADD CONSTRAINT "project_analysis_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_admin_audit_log" ADD CONSTRAINT "platform_admin_audit_log_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_admin_audit_log" ADD CONSTRAINT "platform_admin_audit_log_performed_by_user_id_fk" FOREIGN KEY ("performed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_request_state" ADD CONSTRAINT "pull_request_state_repository_id_repository_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repository"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_request_trigger" ADD CONSTRAINT "pull_request_trigger_repository_id_repository_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repository"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_request_trigger" ADD CONSTRAINT "pull_request_trigger_installation_id_github_installation_installation_id_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."github_installation"("installation_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_request_trigger" ADD CONSTRAINT "pull_request_trigger_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_linear_settings" ADD CONSTRAINT "project_linear_settings_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_repository" ADD CONSTRAINT "project_repository_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_repository" ADD CONSTRAINT "project_repository_repository_id_repository_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repository"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question" ADD CONSTRAINT "question_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question" ADD CONSTRAINT "question_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question" ADD CONSTRAINT "question_repository_id_repository_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repository"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question" ADD CONSTRAINT "question_goal_id_goal_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question" ADD CONSTRAINT "question_prd_id_prd_id_fk" FOREIGN KEY ("prd_id") REFERENCES "public"."prd"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question" ADD CONSTRAINT "question_technical_spec_id_technical_spec_id_fk" FOREIGN KEY ("technical_spec_id") REFERENCES "public"."technical_spec"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question" ADD CONSTRAINT "question_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sandbox_lifecycle_event" ADD CONSTRAINT "sandbox_lifecycle_event_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sandbox_lifecycle_event" ADD CONSTRAINT "sandbox_lifecycle_event_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sandbox_lifecycle_event" ADD CONSTRAINT "sandbox_lifecycle_event_repository_id_repository_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repository"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sandbox_lifecycle_event" ADD CONSTRAINT "sandbox_lifecycle_event_goal_id_goal_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goal"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sandbox_lifecycle_event" ADD CONSTRAINT "sandbox_lifecycle_event_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sandbox_lifecycle_snapshot" ADD CONSTRAINT "sandbox_lifecycle_snapshot_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sandbox_lifecycle_snapshot" ADD CONSTRAINT "sandbox_lifecycle_snapshot_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sandbox_lifecycle_snapshot" ADD CONSTRAINT "sandbox_lifecycle_snapshot_repository_id_repository_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repository"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sandbox_lifecycle_snapshot" ADD CONSTRAINT "sandbox_lifecycle_snapshot_goal_id_goal_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goal"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sandbox_lifecycle_snapshot" ADD CONSTRAINT "sandbox_lifecycle_snapshot_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_event" ADD CONSTRAINT "session_event_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_event" ADD CONSTRAINT "session_event_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_audit_log" ADD CONSTRAINT "service_audit_log_service_account_id_service_account_id_fk" FOREIGN KEY ("service_account_id") REFERENCES "public"."service_account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_audit_log" ADD CONSTRAINT "service_audit_log_service_key_id_service_key_id_fk" FOREIGN KEY ("service_key_id") REFERENCES "public"."service_key"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_key" ADD CONSTRAINT "service_key_service_account_id_service_account_id_fk" FOREIGN KEY ("service_account_id") REFERENCES "public"."service_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_technical_spec_id_technical_spec_id_fk" FOREIGN KEY ("technical_spec_id") REFERENCES "public"."technical_spec"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependency" ADD CONSTRAINT "task_dependency_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependency" ADD CONSTRAINT "task_dependency_depends_on_task_id_task_id_fk" FOREIGN KEY ("depends_on_task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "technical_spec" ADD CONSTRAINT "technical_spec_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "technical_spec" ADD CONSTRAINT "technical_spec_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "technical_spec" ADD CONSTRAINT "technical_spec_repository_id_repository_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repository"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "technical_spec" ADD CONSTRAINT "technical_spec_prd_id_prd_id_fk" FOREIGN KEY ("prd_id") REFERENCES "public"."prd"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "technical_spec" ADD CONSTRAINT "technical_spec_revised_from_technical_spec_id_technical_spec_id_fk" FOREIGN KEY ("revised_from_technical_spec_id") REFERENCES "public"."technical_spec"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "technical_spec" ADD CONSTRAINT "technical_spec_artifact_id_analysis_context_artifact_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."analysis_context_artifact"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "technical_spec" ADD CONSTRAINT "technical_spec_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_api_key" ADD CONSTRAINT "user_api_key_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_event" ADD CONSTRAINT "webhook_event_repository_id_repository_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repository"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_config" ADD CONSTRAINT "workflow_config_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_issue_reference" ADD CONSTRAINT "workflow_issue_reference_workflow_run_id_workflow_run_id_fk" FOREIGN KEY ("workflow_run_id") REFERENCES "public"."workflow_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_run" ADD CONSTRAINT "workflow_run_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_run" ADD CONSTRAINT "workflow_run_repository_id_repository_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repository"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_run" ADD CONSTRAINT "workflow_run_triggered_by_user_id_user_id_fk" FOREIGN KEY ("triggered_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_run" ADD CONSTRAINT "workflow_run_trigger_id_pull_request_trigger_id_fk" FOREIGN KEY ("trigger_id") REFERENCES "public"."pull_request_trigger"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_github_installation" ADD CONSTRAINT "workspace_github_installation_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_github_installation" ADD CONSTRAINT "workspace_github_installation_installation_id_github_installation_installation_id_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."github_installation"("installation_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_github_installation" ADD CONSTRAINT "workspace_github_installation_connected_by_user_id_user_id_fk" FOREIGN KEY ("connected_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_credential" ADD CONSTRAINT "integration_credential_workspace_integration_id_workspace_integration_id_fk" FOREIGN KEY ("workspace_integration_id") REFERENCES "public"."workspace_integration"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_integration" ADD CONSTRAINT "workspace_integration_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_integration" ADD CONSTRAINT "workspace_integration_connected_by_user_id_user_id_fk" FOREIGN KEY ("connected_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_integration_resource" ADD CONSTRAINT "workspace_integration_resource_workspace_integration_id_workspace_integration_id_fk" FOREIGN KEY ("workspace_integration_id") REFERENCES "public"."workspace_integration"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_invitation" ADD CONSTRAINT "workspace_invitation_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_invitation" ADD CONSTRAINT "workspace_invitation_inviter_user_id_user_id_fk" FOREIGN KEY ("inviter_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_invitation" ADD CONSTRAINT "workspace_invitation_accepted_by_user_id_user_id_fk" FOREIGN KEY ("accepted_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_membership" ADD CONSTRAINT "workspace_membership_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_membership" ADD CONSTRAINT "workspace_membership_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_checkpoint_workflow_run_idx" ON "agent_checkpoint" USING btree ("workflow_id","run_id");--> statement-breakpoint
CREATE INDEX "agent_checkpoint_created_at_idx" ON "agent_checkpoint" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_architecture_project_idx" ON "analysis_architecture" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_architecture_version_unique_idx" ON "analysis_architecture_version" USING btree ("architecture_id","version_number");--> statement-breakpoint
CREATE INDEX "analysis_architecture_version_arch_idx" ON "analysis_architecture_version" USING btree ("architecture_id");--> statement-breakpoint
CREATE INDEX "analysis_architecture_version_run_idx" ON "analysis_architecture_version" USING btree ("pipeline_run_id");--> statement-breakpoint
CREATE INDEX "analysis_capability_project_idx" ON "analysis_capability" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_capability_project_key_idx" ON "analysis_capability" USING btree ("project_id","capability_key");--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_capability_version_unique_idx" ON "analysis_capability_version" USING btree ("capability_id","version_number");--> statement-breakpoint
CREATE INDEX "analysis_capability_version_capability_idx" ON "analysis_capability_version" USING btree ("capability_id");--> statement-breakpoint
CREATE INDEX "analysis_capability_version_run_idx" ON "analysis_capability_version" USING btree ("pipeline_run_id");--> statement-breakpoint
CREATE INDEX "analysis_connected_repo_project_idx" ON "analysis_connected_repo" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_connected_repo_project_name_idx" ON "analysis_connected_repo" USING btree ("project_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_connected_repo_version_unique_idx" ON "analysis_connected_repo_version" USING btree ("connected_repo_id","version_number");--> statement-breakpoint
CREATE INDEX "analysis_connected_repo_version_cr_idx" ON "analysis_connected_repo_version" USING btree ("connected_repo_id");--> statement-breakpoint
CREATE INDEX "analysis_connected_repo_version_run_idx" ON "analysis_connected_repo_version" USING btree ("pipeline_run_id");--> statement-breakpoint
CREATE INDEX "analysis_context_project_idx" ON "analysis_context" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "analysis_context_project_pipeline_slug_idx" ON "analysis_context" USING btree ("project_id","pipeline_slug");--> statement-breakpoint
CREATE INDEX "analysis_context_artifact_project_idx" ON "analysis_context_artifact" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "analysis_context_artifact_session_idx" ON "analysis_context_artifact" USING btree ("originating_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_dependency_project_idx" ON "analysis_dependency" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_dependency_version_unique_idx" ON "analysis_dependency_version" USING btree ("dependency_id","version_number");--> statement-breakpoint
CREATE INDEX "analysis_dependency_version_dep_idx" ON "analysis_dependency_version" USING btree ("dependency_id");--> statement-breakpoint
CREATE INDEX "analysis_dependency_version_run_idx" ON "analysis_dependency_version" USING btree ("pipeline_run_id");--> statement-breakpoint
CREATE INDEX "analysis_deployment_ctx_project_idx" ON "analysis_deployment_context" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_deployment_ctx_project_name_idx" ON "analysis_deployment_context" USING btree ("project_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_deployment_ctx_version_unique_idx" ON "analysis_deployment_context_version" USING btree ("deployment_context_id","version_number");--> statement-breakpoint
CREATE INDEX "analysis_deployment_ctx_version_dc_idx" ON "analysis_deployment_context_version" USING btree ("deployment_context_id");--> statement-breakpoint
CREATE INDEX "analysis_deployment_ctx_version_run_idx" ON "analysis_deployment_context_version" USING btree ("pipeline_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_diagram_project_idx" ON "analysis_diagram" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_diagram_version_unique_idx" ON "analysis_diagram_version" USING btree ("diagram_id","version_number");--> statement-breakpoint
CREATE INDEX "analysis_diagram_version_diagram_idx" ON "analysis_diagram_version" USING btree ("diagram_id");--> statement-breakpoint
CREATE INDEX "analysis_diagram_version_run_idx" ON "analysis_diagram_version" USING btree ("pipeline_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_etiquette_project_idx" ON "analysis_etiquette" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_etiquette_version_unique_idx" ON "analysis_etiquette_version" USING btree ("etiquette_id","version_number");--> statement-breakpoint
CREATE INDEX "analysis_etiquette_version_etiquette_idx" ON "analysis_etiquette_version" USING btree ("etiquette_id");--> statement-breakpoint
CREATE INDEX "analysis_etiquette_version_run_idx" ON "analysis_etiquette_version" USING btree ("pipeline_run_id");--> statement-breakpoint
CREATE INDEX "analysis_ext_integration_project_idx" ON "analysis_external_integration" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_ext_integration_project_name_idx" ON "analysis_external_integration" USING btree ("project_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_ext_integration_version_unique_idx" ON "analysis_external_integration_version" USING btree ("external_integration_id","version_number");--> statement-breakpoint
CREATE INDEX "analysis_ext_integration_version_ei_idx" ON "analysis_external_integration_version" USING btree ("external_integration_id");--> statement-breakpoint
CREATE INDEX "analysis_ext_integration_version_run_idx" ON "analysis_external_integration_version" USING btree ("pipeline_run_id");--> statement-breakpoint
CREATE INDEX "analysis_feature_project_idx" ON "analysis_feature" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_feature_project_key_idx" ON "analysis_feature" USING btree ("project_id","feature_key");--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_feature_version_unique_idx" ON "analysis_feature_version" USING btree ("feature_id","version_number");--> statement-breakpoint
CREATE INDEX "analysis_feature_version_feature_idx" ON "analysis_feature_version" USING btree ("feature_id");--> statement-breakpoint
CREATE INDEX "analysis_feature_version_run_idx" ON "analysis_feature_version" USING btree ("pipeline_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_intra_dependency_project_idx" ON "analysis_intra_dependency" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_intra_dependency_version_unique_idx" ON "analysis_intra_dependency_version" USING btree ("intra_dependency_id","version_number");--> statement-breakpoint
CREATE INDEX "analysis_intra_dependency_version_id_idx" ON "analysis_intra_dependency_version" USING btree ("intra_dependency_id");--> statement-breakpoint
CREATE INDEX "analysis_intra_dependency_version_run_idx" ON "analysis_intra_dependency_version" USING btree ("pipeline_run_id");--> statement-breakpoint
CREATE INDEX "analysis_layer_project_idx" ON "analysis_layer" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_layer_project_name_idx" ON "analysis_layer" USING btree ("project_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_layer_version_unique_idx" ON "analysis_layer_version" USING btree ("layer_id","version_number");--> statement-breakpoint
CREATE INDEX "analysis_layer_version_layer_idx" ON "analysis_layer_version" USING btree ("layer_id");--> statement-breakpoint
CREATE INDEX "analysis_layer_version_run_idx" ON "analysis_layer_version" USING btree ("pipeline_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_project_summary_project_idx" ON "analysis_project_summary" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_project_summary_version_unique_idx" ON "analysis_project_summary_version" USING btree ("project_summary_id","version_number");--> statement-breakpoint
CREATE INDEX "analysis_project_summary_version_ps_idx" ON "analysis_project_summary_version" USING btree ("project_summary_id");--> statement-breakpoint
CREATE INDEX "analysis_project_summary_version_run_idx" ON "analysis_project_summary_version" USING btree ("pipeline_run_id");--> statement-breakpoint
CREATE INDEX "analysis_run_repository_workflow_id_idx" ON "analysis_run_repository" USING btree ("workflow_id");--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_setup_project_idx" ON "analysis_setup" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_setup_version_unique_idx" ON "analysis_setup_version" USING btree ("setup_id","version_number");--> statement-breakpoint
CREATE INDEX "analysis_setup_version_setup_idx" ON "analysis_setup_version" USING btree ("setup_id");--> statement-breakpoint
CREATE INDEX "analysis_setup_version_run_idx" ON "analysis_setup_version" USING btree ("pipeline_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_ux_project_idx" ON "analysis_ux" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_ux_version_unique_idx" ON "analysis_ux_version" USING btree ("ux_id","version_number");--> statement-breakpoint
CREATE INDEX "analysis_ux_version_ux_idx" ON "analysis_ux_version" USING btree ("ux_id");--> statement-breakpoint
CREATE INDEX "analysis_ux_version_run_idx" ON "analysis_ux_version" USING btree ("pipeline_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "answer_question_unique_idx" ON "answer" USING btree ("question_id");--> statement-breakpoint
CREATE INDEX "answer_question_idx" ON "answer" USING btree ("question_id");--> statement-breakpoint
CREATE INDEX "answer_current_version_idx" ON "answer" USING btree ("current_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "answer_version_answer_number_idx" ON "answer_version" USING btree ("answer_id","version_number");--> statement-breakpoint
CREATE INDEX "answer_version_question_idx" ON "answer_version" USING btree ("question_id");--> statement-breakpoint
CREATE INDEX "answer_version_created_at_idx" ON "answer_version" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_account_provider_user_idx" ON "auth_account" USING btree ("provider","provider_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_account_user_provider_idx" ON "auth_account" USING btree ("user_id","provider");--> statement-breakpoint
CREATE INDEX "auth_account_user_idx" ON "auth_account" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "claude_session_workflow_session_idx" ON "claude_session" USING btree ("workflow_id","session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "draft_version_workflow_phase_version_idx" ON "draft_version" USING btree ("workflow_id","phase_id","version");--> statement-breakpoint
CREATE INDEX "flow_workspace_idx" ON "flow" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "flow_type_idx" ON "flow" USING btree ("type");--> statement-breakpoint
CREATE INDEX "flow_status_idx" ON "flow" USING btree ("status");--> statement-breakpoint
CREATE INDEX "flow_prd_idx" ON "flow" USING btree ("prd_id");--> statement-breakpoint
CREATE INDEX "github_installation_status_idx" ON "github_installation" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "github_installation_repository_unique" ON "github_installation_repository" USING btree ("installation_id","repository_id");--> statement-breakpoint
CREATE INDEX "github_installation_repository_installation_idx" ON "github_installation_repository" USING btree ("installation_id");--> statement-breakpoint
CREATE INDEX "github_installation_repository_repository_idx" ON "github_installation_repository" USING btree ("repository_id");--> statement-breakpoint
CREATE UNIQUE INDEX "github_webhook_delivery_unique" ON "github_webhook_delivery" USING btree ("delivery_id","event_type");--> statement-breakpoint
CREATE INDEX "goal_workspace_idx" ON "goal" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "goal_project_idx" ON "goal" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "goal_repository_idx" ON "goal" USING btree ("repository_id");--> statement-breakpoint
CREATE INDEX "goal_parent_idx" ON "goal" USING btree ("parent_goal_id");--> statement-breakpoint
CREATE INDEX "goal_status_idx" ON "goal" USING btree ("status");--> statement-breakpoint
CREATE INDEX "goal_created_by_idx" ON "goal" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "goal_version_goal_number_idx" ON "goal_version" USING btree ("goal_id","version_number");--> statement-breakpoint
CREATE INDEX "goal_version_goal_idx" ON "goal_version" USING btree ("goal_id");--> statement-breakpoint
CREATE INDEX "goal_version_created_at_idx" ON "goal_version" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "integration_audit_log_workspace_idx" ON "integration_audit_log" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "integration_audit_log_created_at_idx" ON "integration_audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "integration_audit_log_workspace_provider_idx" ON "integration_audit_log" USING btree ("workspace_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "linear_comment_project_linear_id_unique" ON "linear_comment" USING btree ("project_id","linear_id");--> statement-breakpoint
CREATE INDEX "linear_comment_issue_idx" ON "linear_comment" USING btree ("issue_id");--> statement-breakpoint
CREATE UNIQUE INDEX "linear_issue_project_linear_id_unique" ON "linear_issue" USING btree ("project_id","linear_id");--> statement-breakpoint
CREATE INDEX "linear_issue_team_idx" ON "linear_issue" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "linear_issue_linear_project_idx" ON "linear_issue" USING btree ("linear_project_id");--> statement-breakpoint
CREATE INDEX "linear_issue_state_type_idx" ON "linear_issue" USING btree ("project_id","state_type");--> statement-breakpoint
CREATE INDEX "linear_issue_assignee_idx" ON "linear_issue" USING btree ("project_id","assignee_id");--> statement-breakpoint
CREATE INDEX "linear_issue_cursor_idx" ON "linear_issue" USING btree ("project_id","linear_updated_at","linear_id");--> statement-breakpoint
CREATE INDEX "linear_issue_label_label_idx" ON "linear_issue_label" USING btree ("label_id");--> statement-breakpoint
CREATE UNIQUE INDEX "linear_label_project_linear_id_unique" ON "linear_label" USING btree ("project_id","linear_id");--> statement-breakpoint
CREATE INDEX "linear_label_team_idx" ON "linear_label" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "linear_project_project_linear_id_unique" ON "linear_project" USING btree ("project_id","linear_id");--> statement-breakpoint
CREATE INDEX "linear_project_team_idx" ON "linear_project" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "linear_project_repo_mapping_unique" ON "linear_project_repo_mapping" USING btree ("project_id","linear_project_id");--> statement-breakpoint
CREATE INDEX "linear_project_repo_mapping_project_idx" ON "linear_project_repo_mapping" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "linear_project_repo_mapping_linear_project_idx" ON "linear_project_repo_mapping" USING btree ("linear_project_id");--> statement-breakpoint
CREATE INDEX "linear_project_repo_mapping_repository_idx" ON "linear_project_repo_mapping" USING btree ("repository_id");--> statement-breakpoint
CREATE UNIQUE INDEX "linear_team_project_linear_id_unique" ON "linear_team" USING btree ("project_id","linear_id");--> statement-breakpoint
CREATE INDEX "linear_team_project_idx" ON "linear_team" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "linear_webhook_id_unique" ON "linear_webhook" USING btree ("linear_webhook_id");--> statement-breakpoint
CREATE INDEX "linear_webhook_integration_idx" ON "linear_webhook" USING btree ("workspace_integration_id");--> statement-breakpoint
CREATE INDEX "linear_webhook_team_idx" ON "linear_webhook" USING btree ("workspace_integration_id","team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "linear_webhook_delivery_unique" ON "linear_webhook_delivery" USING btree ("delivery_id");--> statement-breakpoint
CREATE INDEX "linear_webhook_delivery_processed_idx" ON "linear_webhook_delivery" USING btree ("processed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_connection_user_provider_idx" ON "oauth_connection" USING btree ("user_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "phase_execution_workflow_phase_idx" ON "phase_execution" USING btree ("workflow_id","phase_id");--> statement-breakpoint
CREATE INDEX "phase_execution_workflow_id_idx" ON "phase_execution" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "pipeline_is_enabled_idx" ON "pipeline" USING btree ("is_enabled");--> statement-breakpoint
CREATE UNIQUE INDEX "pipeline_artifact_workflow_phase_version_idx" ON "pipeline_artifact" USING btree ("workflow_id","phase_id","version");--> statement-breakpoint
CREATE INDEX "pipeline_artifact_workflow_id_idx" ON "pipeline_artifact" USING btree ("workflow_id");--> statement-breakpoint
CREATE UNIQUE INDEX "plan_workflow_id_idx" ON "plan" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "plan_goal_id_idx" ON "plan" USING btree ("goal_id");--> statement-breakpoint
CREATE INDEX "plan_project_id_idx" ON "plan" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "plan_status_idx" ON "plan" USING btree ("status");--> statement-breakpoint
CREATE INDEX "prd_workspace_idx" ON "prd" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "prd_project_idx" ON "prd" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "prd_repository_idx" ON "prd" USING btree ("repository_id");--> statement-breakpoint
CREATE INDEX "prd_goal_idx" ON "prd" USING btree ("goal_id");--> statement-breakpoint
CREATE INDEX "prd_status_idx" ON "prd" USING btree ("status");--> statement-breakpoint
CREATE INDEX "prd_revised_from_idx" ON "prd" USING btree ("revised_from_prd_id");--> statement-breakpoint
CREATE INDEX "prd_artifact_idx" ON "prd" USING btree ("artifact_id");--> statement-breakpoint
CREATE INDEX "prd_created_by_idx" ON "prd" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE INDEX "pipeline_run_pipeline_id_idx" ON "pipeline_run" USING btree ("pipeline_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_analysis_workflow_id_idx" ON "project_analysis" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "project_analysis_project_id_idx" ON "project_analysis" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_analysis_status_idx" ON "project_analysis" USING btree ("status");--> statement-breakpoint
CREATE INDEX "platform_admin_audit_log_user_idx" ON "platform_admin_audit_log" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "platform_admin_audit_log_created_at_idx" ON "platform_admin_audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "platform_admin_audit_log_performed_by_idx" ON "platform_admin_audit_log" USING btree ("performed_by");--> statement-breakpoint
CREATE UNIQUE INDEX "pull_request_state_repo_pr_idx" ON "pull_request_state" USING btree ("repository_id","pr_number");--> statement-breakpoint
CREATE INDEX "pull_request_state_automation_idx" ON "pull_request_state" USING btree ("automation_status");--> statement-breakpoint
CREATE INDEX "pull_request_state_repo_automation_idx" ON "pull_request_state" USING btree ("repository_id","automation_status");--> statement-breakpoint
CREATE INDEX "pull_request_trigger_repo_pr_idx" ON "pull_request_trigger" USING btree ("repository_id","pr_number");--> statement-breakpoint
CREATE UNIQUE INDEX "pull_request_trigger_dedupe_idx" ON "pull_request_trigger" USING btree ("repository_id","pr_number","head_sha","trigger_type","signature");--> statement-breakpoint
CREATE INDEX "pull_request_trigger_status_idx" ON "pull_request_trigger" USING btree ("status");--> statement-breakpoint
CREATE INDEX "pull_request_trigger_next_attempt_idx" ON "pull_request_trigger" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX "project_workspace_handle_idx" ON "project" USING btree ("workspace_id","handle");--> statement-breakpoint
CREATE INDEX "project_workspace_idx" ON "project" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_linear_settings_project_unique" ON "project_linear_settings" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_linear_settings_team_idx" ON "project_linear_settings" USING btree ("linear_team_id");--> statement-breakpoint
CREATE INDEX "project_repository_repository_idx" ON "project_repository" USING btree ("repository_id");--> statement-breakpoint
CREATE INDEX "question_workspace_idx" ON "question" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "question_project_idx" ON "question" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "question_repository_idx" ON "question" USING btree ("repository_id");--> statement-breakpoint
CREATE INDEX "question_goal_idx" ON "question" USING btree ("goal_id");--> statement-breakpoint
CREATE INDEX "question_prd_idx" ON "question" USING btree ("prd_id");--> statement-breakpoint
CREATE INDEX "question_technical_spec_idx" ON "question" USING btree ("technical_spec_id");--> statement-breakpoint
CREATE INDEX "question_status_idx" ON "question" USING btree ("status");--> statement-breakpoint
CREATE INDEX "question_type_idx" ON "question" USING btree ("type");--> statement-breakpoint
CREATE UNIQUE INDEX "question_workspace_idempotency_key_idx" ON "question" USING btree ("workspace_id","idempotency_key") WHERE "question"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "repository_owner_name_idx" ON "repository" USING btree ("owner","name");--> statement-breakpoint
CREATE INDEX "repository_installation_idx" ON "repository" USING btree ("installation_id");--> statement-breakpoint
CREATE INDEX "repository_uri_idx" ON "repository" USING btree ("uri");--> statement-breakpoint
CREATE UNIQUE INDEX "sandbox_lifecycle_event_delivery_unique" ON "sandbox_lifecycle_event" USING btree ("delivery_id");--> statement-breakpoint
CREATE INDEX "sandbox_lifecycle_event_workspace_processed_idx" ON "sandbox_lifecycle_event" USING btree ("workspace_id","processed_at");--> statement-breakpoint
CREATE INDEX "sandbox_lifecycle_event_sandbox_id_idx" ON "sandbox_lifecycle_event" USING btree ("sandbox_id","event_timestamp");--> statement-breakpoint
CREATE UNIQUE INDEX "sandbox_lifecycle_snapshot_sandbox_id_unique" ON "sandbox_lifecycle_snapshot" USING btree ("sandbox_id");--> statement-breakpoint
CREATE INDEX "sandbox_lifecycle_snapshot_workspace_last_event_idx" ON "sandbox_lifecycle_snapshot" USING btree ("workspace_id","last_event_at");--> statement-breakpoint
CREATE INDEX "session_event_workspace_idx" ON "session_event" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "session_event_project_idx" ON "session_event" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "session_event_session_idx" ON "session_event" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "session_event_parent_idx" ON "session_event" USING btree ("parent_uuid");--> statement-breakpoint
CREATE INDEX "session_event_subtype_idx" ON "session_event" USING btree ("subtype");--> statement-breakpoint
CREATE INDEX "service_audit_log_created_at_idx" ON "service_audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "service_audit_log_service_account_idx" ON "service_audit_log" USING btree ("service_account_id");--> statement-breakpoint
CREATE INDEX "service_audit_log_action_created_at_idx" ON "service_audit_log" USING btree ("action","created_at");--> statement-breakpoint
CREATE INDEX "service_key_service_account_idx" ON "service_key" USING btree ("service_account_id");--> statement-breakpoint
CREATE INDEX "task_workspace_idx" ON "task" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "task_technical_spec_idx" ON "task" USING btree ("technical_spec_id");--> statement-breakpoint
CREATE INDEX "task_status_idx" ON "task" USING btree ("status");--> statement-breakpoint
CREATE INDEX "task_created_by_idx" ON "task" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE INDEX "technical_spec_workspace_idx" ON "technical_spec" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "technical_spec_project_idx" ON "technical_spec" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "technical_spec_repository_idx" ON "technical_spec" USING btree ("repository_id");--> statement-breakpoint
CREATE INDEX "technical_spec_prd_idx" ON "technical_spec" USING btree ("prd_id");--> statement-breakpoint
CREATE INDEX "technical_spec_status_idx" ON "technical_spec" USING btree ("status");--> statement-breakpoint
CREATE INDEX "technical_spec_revised_from_idx" ON "technical_spec" USING btree ("revised_from_technical_spec_id");--> statement-breakpoint
CREATE INDEX "technical_spec_artifact_idx" ON "technical_spec" USING btree ("artifact_id");--> statement-breakpoint
CREATE INDEX "technical_spec_created_by_idx" ON "technical_spec" USING btree ("created_by_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_email_lower_idx" ON "user" USING btree (lower("email")) WHERE "user"."email" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "user_username_lower_idx" ON "user" USING btree (lower("username"));--> statement-breakpoint
CREATE INDEX "user_is_platform_admin_idx" ON "user" USING btree ("id") WHERE "user"."is_platform_admin" = true;--> statement-breakpoint
CREATE INDEX "user_api_key_user_idx" ON "user_api_key" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_api_key_prefix_active_idx" ON "user_api_key" USING btree ("key_prefix") WHERE "user_api_key"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "webhook_event_repository_type_idx" ON "webhook_event" USING btree ("repository_id","event_type");--> statement-breakpoint
CREATE INDEX "webhook_event_repository_received_idx" ON "webhook_event" USING btree ("repository_id","received_at");--> statement-breakpoint
CREATE INDEX "webhook_event_repository_created_idx" ON "webhook_event" USING btree ("repository_id","created_at");--> statement-breakpoint
CREATE INDEX "workflow_config_workspace_idx" ON "workflow_config" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "workflow_issue_reference_run_idx" ON "workflow_issue_reference" USING btree ("workflow_run_id");--> statement-breakpoint
CREATE INDEX "workflow_issue_reference_type_issue_idx" ON "workflow_issue_reference" USING btree ("type","issue_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_issue_reference_unique" ON "workflow_issue_reference" USING btree ("workflow_run_id","type","issue_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_run_workflow_id_idx" ON "workflow_run" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "workflow_run_workspace_phase_idx" ON "workflow_run" USING btree ("workspace_id","phase");--> statement-breakpoint
CREATE INDEX "workflow_run_repository_phase_idx" ON "workflow_run" USING btree ("repository_id","phase");--> statement-breakpoint
CREATE INDEX "workflow_run_workspace_created_idx" ON "workflow_run" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "workflow_run_error_code_idx" ON "workflow_run" USING btree ("error_code");--> statement-breakpoint
CREATE INDEX "workflow_run_retry_of_idx" ON "workflow_run" USING btree ("retry_of_workflow_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_github_installation_workspace_installation_unique" ON "workspace_github_installation" USING btree ("workspace_id","installation_id");--> statement-breakpoint
CREATE INDEX "workspace_github_installation_installation_idx" ON "workspace_github_installation" USING btree ("installation_id");--> statement-breakpoint
CREATE INDEX "workspace_github_installation_workspace_idx" ON "workspace_github_installation" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_credential_active_unique" ON "integration_credential" USING btree ("workspace_integration_id","provider","role") WHERE "integration_credential"."is_active" = true;--> statement-breakpoint
CREATE INDEX "integration_credential_role_idx" ON "integration_credential" USING btree ("workspace_integration_id","role");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_integration_workspace_provider_unique" ON "workspace_integration" USING btree ("workspace_id","provider");--> statement-breakpoint
CREATE INDEX "workspace_integration_workspace_idx" ON "workspace_integration" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_integration_resource_unique" ON "workspace_integration_resource" USING btree ("workspace_integration_id","resource_type","external_id");--> statement-breakpoint
CREATE INDEX "workspace_integration_resource_integration_idx" ON "workspace_integration_resource" USING btree ("workspace_integration_id");--> statement-breakpoint
CREATE INDEX "workspace_invitation_workspace_idx" ON "workspace_invitation" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "workspace_invitation_token_idx" ON "workspace_invitation" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "workspace_invitation_invitee_email_idx" ON "workspace_invitation" USING btree (lower("invitee_email"));--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_invitation_pending_email_idx" ON "workspace_invitation" USING btree ("workspace_id",lower("invitee_email")) WHERE "workspace_invitation"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_membership_unique" ON "workspace_membership" USING btree ("workspace_id","user_id");--> statement-breakpoint
CREATE INDEX "workspace_membership_workspace_idx" ON "workspace_membership" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "workspace_membership_user_idx" ON "workspace_membership" USING btree ("user_id");