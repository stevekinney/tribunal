ALTER TABLE "repository_agent" ADD COLUMN "user_id" integer;--> statement-breakpoint
ALTER TABLE "repository_review_settings" ADD COLUMN "user_id" integer;--> statement-breakpoint
UPDATE "repository_agent"
SET "user_id" = "agent"."user_id"
FROM "agent"
WHERE "repository_agent"."agent_id" = "agent"."id"
  AND "repository_agent"."user_id" IS NULL;--> statement-breakpoint
DELETE FROM "repository_agent"
WHERE "user_id" IS NULL;--> statement-breakpoint
UPDATE "repository_review_settings"
SET "user_id" = "owner"."user_id"
FROM (
  -- Before this migration, repository_review_settings had at most one row per
  -- repository, so choosing one active owner preserves the legacy row without
  -- dropping any per-user settings that could not yet exist.
  SELECT DISTINCT ON ("github_installation_repository"."repository_id")
    "github_installation_repository"."repository_id",
    "github_installation"."user_id"
  FROM "github_installation_repository"
  INNER JOIN "github_installation"
    ON "github_installation"."installation_id" = "github_installation_repository"."installation_id"
  LEFT JOIN "repository"
    ON "repository"."id" = "github_installation_repository"."repository_id"
  WHERE "github_installation"."user_id" IS NOT NULL
    AND "github_installation_repository"."is_active" = true
  ORDER BY
    "github_installation_repository"."repository_id",
    CASE
      WHEN "github_installation_repository"."installation_id" = "repository"."installation_id"
      THEN 0
      ELSE 1
    END,
    "github_installation"."id"
) AS "owner"
WHERE "repository_review_settings"."repository_id" = "owner"."repository_id"
  AND "repository_review_settings"."user_id" IS NULL;--> statement-breakpoint
DELETE FROM "repository_review_settings"
WHERE "user_id" IS NULL;--> statement-breakpoint
ALTER TABLE "repository_agent" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "repository_review_settings" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "repository_agent" DROP CONSTRAINT "repository_agent_repository_id_agent_id_pk";--> statement-breakpoint
ALTER TABLE "repository_review_settings" DROP CONSTRAINT "repository_review_settings_pkey";--> statement-breakpoint
ALTER TABLE "repository_agent" ADD CONSTRAINT "repository_agent_user_id_repository_id_agent_id_pk" PRIMARY KEY("user_id","repository_id","agent_id");--> statement-breakpoint
ALTER TABLE "repository_review_settings" ADD CONSTRAINT "repository_review_settings_user_id_repository_id_pk" PRIMARY KEY("user_id","repository_id");--> statement-breakpoint
ALTER TABLE "repository_agent" ADD CONSTRAINT "repository_agent_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_review_settings" ADD CONSTRAINT "repository_review_settings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "repository_agent_repository_idx" ON "repository_agent" USING btree ("repository_id");--> statement-breakpoint
CREATE INDEX "repository_review_settings_repository_idx" ON "repository_review_settings" USING btree ("repository_id");
