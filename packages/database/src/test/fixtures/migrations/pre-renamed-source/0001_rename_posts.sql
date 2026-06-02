-- Attempts to rename "old_posts" to "posts", but "posts" already exists.
-- This should fail with a "relation already exists" error.
ALTER TABLE "old_posts" RENAME TO "posts";
