DO $$ BEGIN
 CREATE TYPE "public"."oauth_connection_status" AS ENUM('active', 'invalid');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "oauth_connection" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
UPDATE "oauth_connection" SET "status" = 'active' WHERE "status" IS NULL;--> statement-breakpoint
UPDATE "oauth_connection" SET "status" = 'invalid' WHERE "status"::text = 'expired';--> statement-breakpoint
ALTER TABLE "oauth_connection" ALTER COLUMN "status" SET DATA TYPE "public"."oauth_connection_status" USING "status"::text::"public"."oauth_connection_status";--> statement-breakpoint
ALTER TABLE "oauth_connection" ALTER COLUMN "status" SET DEFAULT 'active';--> statement-breakpoint
ALTER TABLE "oauth_connection" ALTER COLUMN "status" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "neon_auth_user_id" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oauth_connection_provider_user_idx" ON "oauth_connection" USING btree ("provider","provider_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oauth_connection_user_idx" ON "oauth_connection" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_neon_auth_user_id_idx" ON "user" USING btree ("neon_auth_user_id") WHERE "user"."neon_auth_user_id" IS NOT NULL;--> statement-breakpoint
DROP TABLE IF EXISTS "session" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "auth_account" CASCADE;
