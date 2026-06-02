DO $$
BEGIN
  -- Support both migration paths:
  -- 1) placeholder exists and needs to be renamed
  -- 2) template already exists from prior out-of-band rename
  IF to_regclass('public.placeholder') IS NOT NULL
     AND to_regclass('public.template') IS NULL THEN
    ALTER TABLE "placeholder" RENAME TO "template";
  ELSIF to_regclass('public.placeholder') IS NULL
        AND to_regclass('public.template') IS NOT NULL THEN
    RAISE NOTICE 'Skipping table rename because "template" already exists.';
  ELSIF to_regclass('public.placeholder') IS NULL
        AND to_regclass('public.template') IS NULL THEN
    -- Recover from inconsistent historical state where migrations were marked
    -- as applied but the placeholder/template table is absent.
    CREATE TABLE IF NOT EXISTS "template" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "workspace_id" integer NOT NULL,
      "title" text NOT NULL,
      "description" text NOT NULL,
      "markdown" text NOT NULL,
      "snapshot" text NOT NULL,
      "frontmatter" text NOT NULL,
      "template" text NOT NULL,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL,
      "updated_at" timestamp with time zone DEFAULT now() NOT NULL
    );

    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'template_workspace_id_workspace_id_fk'
    ) THEN
      ALTER TABLE "template"
        ADD CONSTRAINT "template_workspace_id_workspace_id_fk"
        FOREIGN KEY ("workspace_id")
        REFERENCES "public"."workspace"("id")
        ON DELETE cascade
        ON UPDATE no action;
    END IF;

    CREATE INDEX IF NOT EXISTS "template_workspace_idx" ON "template" USING btree ("workspace_id");
  ELSE
    RAISE EXCEPTION 'Cannot rename table: both "placeholder" and "template" exist.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'placeholder_pkey'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'template_pkey'
  ) THEN
    ALTER TABLE "template" RENAME CONSTRAINT "placeholder_pkey" TO "template_pkey";
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'placeholder_workspace_id_workspace_id_fk'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'template_workspace_id_workspace_id_fk'
  ) THEN
    ALTER TABLE "template"
      RENAME CONSTRAINT "placeholder_workspace_id_workspace_id_fk"
      TO "template_workspace_id_workspace_id_fk";
  END IF;

  IF to_regclass('public.placeholder_workspace_idx') IS NOT NULL
     AND to_regclass('public.template_workspace_idx') IS NULL THEN
    ALTER INDEX "placeholder_workspace_idx" RENAME TO "template_workspace_idx";
  END IF;
END
$$;
