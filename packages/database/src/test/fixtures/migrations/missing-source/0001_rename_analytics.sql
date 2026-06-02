-- References a source table that does not exist.
-- This should fail with a "relation does not exist" error.
ALTER TABLE "old_analytics" RENAME TO "analytics";
