-- Renames source table to target. After this migration,
-- "old_sessions" should no longer exist and "sessions" should appear.
ALTER TABLE "old_sessions" RENAME TO "sessions";
