DROP INDEX "review_intent_delivery_kind_idx";--> statement-breakpoint
ALTER TABLE "review_intent" ADD COLUMN "user_id" integer;--> statement-breakpoint
UPDATE "review_intent"
SET "user_id" = "owner"."user_id"
FROM (
  SELECT DISTINCT ON ("review_intent"."id")
    "review_intent"."id",
    "github_installation"."user_id"
  FROM "review_intent"
  INNER JOIN "repository_review_settings"
    ON "repository_review_settings"."repository_id" = "review_intent"."repository_id"
    AND "repository_review_settings"."watched" = true
  INNER JOIN "github_installation_repository"
    ON "github_installation_repository"."repository_id" = "review_intent"."repository_id"
    AND "github_installation_repository"."is_active" = true
  INNER JOIN "github_installation"
    ON "github_installation"."installation_id" = "github_installation_repository"."installation_id"
    AND "github_installation"."user_id" = "repository_review_settings"."user_id"
    AND "github_installation"."status" = 'active'
  INNER JOIN "user_review_settings"
    ON "user_review_settings"."user_id" = "github_installation"."user_id"
    AND "user_review_settings"."reviews_enabled" = true
  LEFT JOIN "repository"
    ON "repository"."id" = "review_intent"."repository_id"
  ORDER BY
    "review_intent"."id",
    CASE
      WHEN "github_installation_repository"."installation_id" = "repository"."installation_id"
      THEN 0
      ELSE 1
    END,
    "github_installation"."id"
) AS "owner"
WHERE "review_intent"."id" = "owner"."id"
  AND "review_intent"."user_id" IS NULL;--> statement-breakpoint
INSERT INTO "review_intent" (
  "id",
  "delivery_id",
  "kind",
  "repository_id",
  "user_id",
  "pr_number",
  "head_sha",
  "pr_state",
  "claimed_at",
  "processed_at",
  "failed_at",
  "next_attempt_at",
  "dead_lettered_at",
  "failure_count",
  "last_error",
  "created_at"
)
SELECT
  "review_intent"."id" || ':user:' || "eligible"."user_id",
  "review_intent"."delivery_id",
  "review_intent"."kind",
  "review_intent"."repository_id",
  "eligible"."user_id",
  "review_intent"."pr_number",
  "review_intent"."head_sha",
  "review_intent"."pr_state",
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  0,
  NULL,
  "review_intent"."created_at"
FROM "review_intent"
INNER JOIN (
  SELECT DISTINCT
    "review_intent"."id" AS "intent_id",
    "github_installation"."user_id"
  FROM "review_intent"
  INNER JOIN "repository_review_settings"
    ON "repository_review_settings"."repository_id" = "review_intent"."repository_id"
    AND "repository_review_settings"."watched" = true
  INNER JOIN "github_installation_repository"
    ON "github_installation_repository"."repository_id" = "review_intent"."repository_id"
    AND "github_installation_repository"."is_active" = true
  INNER JOIN "github_installation"
    ON "github_installation"."installation_id" = "github_installation_repository"."installation_id"
    AND "github_installation"."user_id" = "repository_review_settings"."user_id"
    AND "github_installation"."status" = 'active'
  INNER JOIN "user_review_settings"
    ON "user_review_settings"."user_id" = "github_installation"."user_id"
    AND "user_review_settings"."reviews_enabled" = true
) AS "eligible"
  ON "eligible"."intent_id" = "review_intent"."id"
-- Fan out only unprocessed intents. Already-processed legacy rows keep the
-- single owner assigned above so migration does not re-run historical reviews.
WHERE "review_intent"."processed_at" IS NULL
  AND "review_intent"."user_id" IS DISTINCT FROM "eligible"."user_id";--> statement-breakpoint
DELETE FROM "review_intent"
WHERE "user_id" IS NULL;--> statement-breakpoint
ALTER TABLE "review_intent" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "review_intent" ADD CONSTRAINT "review_intent_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "review_intent_delivery_kind_user_idx" ON "review_intent" USING btree ("delivery_id","kind","user_id");
