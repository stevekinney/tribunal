ALTER TABLE "agent_run" DROP CONSTRAINT IF EXISTS "agent_run_agent_id_agent_id_fk";
--> statement-breakpoint
ALTER TABLE "agent_run" ADD COLUMN IF NOT EXISTS "agent_slug" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_run" ADD COLUMN IF NOT EXISTS "agent_description" text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "set_agent_run_snapshot"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  snapshot record;
BEGIN
  IF NEW."agent_id" IS NOT NULL
     AND (NEW."agent_slug" = '' OR NEW."agent_description" = '') THEN
    SELECT "slug", "description"
    INTO snapshot
    FROM "agent"
    WHERE "id" = NEW."agent_id";

    IF FOUND THEN
      IF NEW."agent_slug" = '' THEN
        NEW."agent_slug" := snapshot."slug";
      END IF;

      IF NEW."agent_description" = '' THEN
        NEW."agent_description" := snapshot."description";
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "agent_run_snapshot_trigger" ON "agent_run";
--> statement-breakpoint
CREATE TRIGGER "agent_run_snapshot_trigger"
BEFORE INSERT OR UPDATE OF "agent_id", "agent_slug", "agent_description" ON "agent_run"
FOR EACH ROW
EXECUTE FUNCTION "set_agent_run_snapshot"();
--> statement-breakpoint
DO $$
DECLARE
  updated_count integer;
BEGIN
  LOOP
    WITH rows_to_update AS (
      SELECT "agent_run"."id"
      FROM "agent_run"
      INNER JOIN "agent" ON "agent"."id" = "agent_run"."agent_id"
      WHERE "agent_run"."agent_id" IS NOT NULL
        AND (
          "agent_run"."agent_slug" = ''
          OR "agent_run"."agent_description" = ''
        )
      ORDER BY "agent_run"."id"
      LIMIT 1000
    )
    UPDATE "agent_run"
    SET
      "agent_slug" = CASE
        WHEN "agent_run"."agent_slug" = '' THEN "agent"."slug"
        ELSE "agent_run"."agent_slug"
      END,
      "agent_description" = CASE
        WHEN "agent_run"."agent_description" = '' THEN "agent"."description"
        ELSE "agent_run"."agent_description"
      END
    FROM "agent", rows_to_update
    WHERE "agent_run"."id" = rows_to_update."id"
      AND "agent_run"."agent_id" = "agent"."id";

    GET DIAGNOSTICS updated_count = ROW_COUNT;
    EXIT WHEN updated_count = 0;
  END LOOP;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'agent_run_agent_id_agent_id_fk'
      AND connamespace = 'public'::regnamespace
  ) THEN
    ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_agent_id_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
