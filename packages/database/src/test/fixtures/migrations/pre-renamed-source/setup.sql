-- Setup: create target table ahead of migration to simulate
-- a scenario where the target already exists (e.g., manual intervention
-- or a previously interrupted migration).
CREATE TABLE IF NOT EXISTS "posts" (
  "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "title" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
