-- Custom SQL migration file, put your code below! --

-- Replace email-based invitations with shareable workspace invite links
-- This migration removes the old workspace_invitation table and invitation_status enum
-- and replaces them with workspaceInviteLink and workspaceInviteLinkUse tables.

-- Step 1: Create new workspace_invite_link table
CREATE TABLE IF NOT EXISTS "workspace_invite_link" (
  "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "workspace_invite_link_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
  "workspace_id" integer NOT NULL,
  "created_by_user_id" integer NOT NULL,
  "role" "workspace_role" NOT NULL,
  "token_hash" text NOT NULL UNIQUE,
  "label" text,
  "max_uses" integer,
  "use_count" integer DEFAULT 0 NOT NULL,
  "password_hash" text,
  "expires_at" timestamp with time zone,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "workspace_invite_link_max_uses_range" CHECK (max_uses > 0 AND max_uses <= 10000)
);
--> statement-breakpoint
ALTER TABLE "workspace_invite_link" ADD CONSTRAINT "workspace_invite_link_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workspace_invite_link" ADD CONSTRAINT "workspace_invite_link_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspace_invite_link_workspace_idx" ON "workspace_invite_link" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspace_invite_link_created_by_idx" ON "workspace_invite_link" USING btree ("created_by_user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspace_invite_link_active_workspace_idx" ON "workspace_invite_link" USING btree ("workspace_id","is_active") WHERE "is_active" = true;

-- Step 2: Create workspace_invite_link_use table
CREATE TABLE IF NOT EXISTS "workspace_invite_link_use" (
  "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "workspace_invite_link_use_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
  "invite_link_id" integer NOT NULL,
  "user_id" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspace_invite_link_use" ADD CONSTRAINT "workspace_invite_link_use_invite_link_id_workspace_invite_link_id_fk" FOREIGN KEY ("invite_link_id") REFERENCES "public"."workspace_invite_link"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workspace_invite_link_use" ADD CONSTRAINT "workspace_invite_link_use_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "workspace_invite_link_use_unique_idx" ON "workspace_invite_link_use" USING btree ("invite_link_id","user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspace_invite_link_use_invite_link_idx" ON "workspace_invite_link_use" USING btree ("invite_link_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspace_invite_link_use_user_idx" ON "workspace_invite_link_use" USING btree ("user_id");

-- Step 3: Drop old workspace_invitation table (no data migration - intentional clean break)
DROP TABLE IF EXISTS "workspace_invitation";

-- Step 4: Drop invitation_status enum (no longer needed)
DROP TYPE IF EXISTS "invitation_status";