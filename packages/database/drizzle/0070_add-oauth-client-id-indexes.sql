-- Hand-written (drizzle-kit generate --custom).
--
-- The OAuth tables in migration 0069 come from `@lostgradient/mcp`'s
-- `createPostgresOAuthSchema` factory, which indexes `user_id`, `expires_at`,
-- `family_id`, `access_token_hash`, and `consent_binding_hash` but NOT the
-- `client_id` foreign-key columns on the four child tables. Tribunal's
-- `foreign_keys_have_indexes` invariant (packages/database/src/test/validate-invariants.ts)
-- requires every foreign-key column to be indexed, so these indexes are added
-- here. The factory exposes no option to add them, so they cannot live in the
-- drizzle schema and are written as a custom migration instead.
--
-- Names follow the factory's own convention so the schema converges cleanly
-- once the gap is fixed upstream (TRI-105 is the precedent for a protokit fix
-- filed in TRI). When a future `@lostgradient/mcp` release indexes `client_id`
-- itself, the migration that adopts it must DROP these four indexes in the same
-- migration, because the generated names will collide.
--
-- Plain CREATE INDEX (not CONCURRENTLY): CONCURRENTLY cannot run inside a
-- migration transaction, and these tables were created empty in 0069.
CREATE INDEX "oauth_transactions_client_idx" ON "oauth_authorization_transactions" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "oauth_codes_client_idx" ON "oauth_codes" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "oauth_access_client_idx" ON "oauth_access_tokens" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "oauth_refresh_client_idx" ON "oauth_refresh_tokens" USING btree ("client_id");
