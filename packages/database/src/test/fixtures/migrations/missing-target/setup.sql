-- Setup: create the source table that the migration will rename.
CREATE TABLE IF NOT EXISTS "old_sessions" (
  "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "token" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
