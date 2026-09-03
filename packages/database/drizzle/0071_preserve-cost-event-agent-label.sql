ALTER TABLE "cost_event" ADD COLUMN IF NOT EXISTS "agent_label" text DEFAULT '' NOT NULL;
--> statement-breakpoint
-- Snapshot trigger, mirroring `agent_run`'s `set_agent_run_snapshot` (see
-- 0052_preserve-agent-run-history.sql). `cost_event` rows are append-only --
-- no writer in this codebase updates one after insert -- so this only needs
-- to cover INSERT, unlike `agent_run`'s BEFORE INSERT OR UPDATE trigger. It
-- exists so an old (N-1) application binary that inserts `agent_id` without
-- `agent_label` during a rolling deploy still gets a label snapshot, from
-- whichever `agent` row is still live at insert time.
CREATE OR REPLACE FUNCTION "set_cost_event_agent_label_snapshot"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  snapshot_slug text;
BEGIN
  IF NEW."agent_id" IS NOT NULL AND NEW."agent_label" = '' THEN
    SELECT "slug" INTO snapshot_slug FROM "agent" WHERE "id" = NEW."agent_id";

    IF FOUND THEN
      NEW."agent_label" := snapshot_slug;
    END IF;
  END IF;

  RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "cost_event_agent_label_snapshot_trigger" ON "cost_event";
--> statement-breakpoint
CREATE TRIGGER "cost_event_agent_label_snapshot_trigger"
BEFORE INSERT ON "cost_event"
FOR EACH ROW
EXECUTE FUNCTION "set_cost_event_agent_label_snapshot"();
--> statement-breakpoint
-- Backfill, pass 1: rows whose `agent_run` snapshot can still supply a label,
-- including rows whose `cost_event.agent_id` is already NULL because the
-- agent was deleted before this migration ran -- exactly the case this issue
-- exists to fix. Matched by the deterministic LLM-estimate idempotency key
-- (`llm:<agent_run.id>:estimate`, see identifiers.ts) joined to the
-- immutable `agent_run.id`, restricted to `role = 'specialist'` so this
-- mirrors the forward-write rule in `review-workflow.ts::finishAgentRun`
-- exactly: triage/verifier runs have no configured agent and keep the ''
-- default both going forward and here.
DO $$
DECLARE
  updated_count integer;
BEGIN
  LOOP
    WITH rows_to_update AS (
      SELECT "cost_event"."idempotency_key" AS idempotency_key
      FROM "cost_event"
      INNER JOIN "agent_run"
        ON "cost_event"."idempotency_key" = 'llm:' || "agent_run"."id" || ':estimate'
      WHERE "cost_event"."agent_label" = ''
        AND "agent_run"."role" = 'specialist'
        AND "agent_run"."agent_slug" != ''
      ORDER BY "cost_event"."idempotency_key"
      LIMIT 1000
    )
    UPDATE "cost_event"
    SET "agent_label" = "agent_run"."agent_slug"
    FROM "agent_run", rows_to_update
    WHERE "cost_event"."idempotency_key" = rows_to_update.idempotency_key
      AND "cost_event"."idempotency_key" = 'llm:' || "agent_run"."id" || ':estimate';

    GET DIAGNOSTICS updated_count = ROW_COUNT;
    EXIT WHEN updated_count = 0;
  END LOOP;
END $$;
--> statement-breakpoint
-- Backfill, pass 2: any remaining unlabeled rows whose `agent_id` still
-- points at a live `agent` row (no matching `agent_run`, or a non-LLM
-- source such as a reconciled adjustment). Mirrors 0052's still-live-agent
-- backfill.
DO $$
DECLARE
  updated_count integer;
BEGIN
  LOOP
    WITH rows_to_update AS (
      SELECT "cost_event"."idempotency_key" AS idempotency_key
      FROM "cost_event"
      INNER JOIN "agent" ON "agent"."id" = "cost_event"."agent_id"
      WHERE "cost_event"."agent_label" = ''
        AND "cost_event"."agent_id" IS NOT NULL
      ORDER BY "cost_event"."idempotency_key"
      LIMIT 1000
    )
    UPDATE "cost_event"
    SET "agent_label" = "agent"."slug"
    FROM "agent", rows_to_update
    WHERE "cost_event"."idempotency_key" = rows_to_update.idempotency_key
      AND "cost_event"."agent_id" = "agent"."id";

    GET DIAGNOSTICS updated_count = ROW_COUNT;
    EXIT WHEN updated_count = 0;
  END LOOP;
END $$;
--> statement-breakpoint
-- Anything still `agent_label = ''` after both passes is left at the
-- default and reads back as "Unassigned": sandbox costs, triage/verifier
-- runs, cost events whose agent was already deleted with no surviving
-- `agent_run` row to recover a slug from, and cost events predating the
-- `agent_run` table entirely. There is no further data in this schema that
-- could recover a label for those rows.