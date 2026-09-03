import { integer } from 'drizzle-orm/pg-core';
import { createPostgresOAuthSchema } from '@lostgradient/mcp/oauth/postgres';
import { z } from 'zod';
import { user } from './user';

/**
 * Tribunal's OAuth persistence, instantiated from the published engine's
 * schema factory rather than declared by hand.
 *
 * The table shapes, all query logic, credential hashing, and refresh-family
 * lineage handling live in `@lostgradient/mcp`'s Postgres adapter. This module
 * only supplies the one thing the library cannot: the host's user identifier
 * type. The library's stores take an opaque `userId: string` at their
 * interface, which resolves nothing at the column level — Protokit's own
 * `users.id` is `uuid`, while Tribunal's `user.id` is
 * `integer(...).generatedAlwaysAsIdentity()`. A foreign key repointed without
 * the type change fails at migration time, which is exactly why the engine
 * exports a factory taking the host's id column builder instead of fixed
 * tables.
 *
 * The builder below matches Tribunal's existing satellite-table precedent,
 * `oauth-connection.ts`: `integer('user_id')` referencing `user(id)` with
 * `onDelete: 'cascade'`. It is `notNull` because every OAuth row the stores
 * write belongs to a user — the library's own row types make `userId`
 * non-nullable on the transaction, code, access-token, and refresh-token
 * tables. `clients` has no user column: dynamic client registration is not
 * per-user, so the factory never calls the builder there.
 *
 * Requires `@lostgradient/mcp@0.2.1`: the refresh-token-to-access-token foreign
 * key gained `ON DELETE CASCADE` in that release (the upstream cascade fix),
 * without which the no-orphaned-credentials policy would not hold for this
 * instantiation.
 */
const oauthSchema = createPostgresOAuthSchema({
  prefix: 'oauth',
  userId: () =>
    integer('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
});

/**
 * The assembled schema object in the exact shape `createPostgresOAuthStores`
 * expects (`{ clients, transactions, codes, accessTokens, refreshTokens }`).
 * Exported so the store wiring (TRI-40 onward) constructs its stores from one
 * canonical object rather than re-assembling the five tables at each call site
 * and risking a mismatched key.
 */
export const oauthEngineSchema = oauthSchema;

export const oauthClients = oauthSchema.clients;
export const oauthAuthorizationTransactions = oauthSchema.transactions;
export const oauthCodes = oauthSchema.codes;
export const oauthAccessTokens = oauthSchema.accessTokens;
export const oauthRefreshTokens = oauthSchema.refreshTokens;

export type OAuthClient = typeof oauthClients.$inferSelect;
export type NewOAuthClient = typeof oauthClients.$inferInsert;
export type OAuthAuthorizationTransaction = typeof oauthAuthorizationTransactions.$inferSelect;
export type NewOAuthAuthorizationTransaction = typeof oauthAuthorizationTransactions.$inferInsert;
export type OAuthCode = typeof oauthCodes.$inferSelect;
export type NewOAuthCode = typeof oauthCodes.$inferInsert;
export type OAuthAccessToken = typeof oauthAccessTokens.$inferSelect;
export type NewOAuthAccessToken = typeof oauthAccessTokens.$inferInsert;
export type OAuthRefreshToken = typeof oauthRefreshTokens.$inferSelect;
export type NewOAuthRefreshToken = typeof oauthRefreshTokens.$inferInsert;

/**
 * Hand-written row validators, one per OAuth table.
 *
 * Hand-written and never drizzle-zod: that is a repository convention, and the
 * library — which owns no zod of its own for these tables, only plain
 * TypeScript row types — does not override it. Keeping the shapes here rather
 * than derived means the string-array `jsonb` columns are validated as arrays
 * (matching `$type<string[]>()`), and a column added or retyped upstream shows
 * up as a mismatch a reader has to reconcile rather than a silently regenerated
 * schema. `oauth.test.ts` parses rows the library's stores actually write
 * through these, so they validate the real persisted shapes rather than an
 * assumed one.
 */
// A timestamp column reads back as a `Date` through a drizzle select and as a
// textual timestamp `string` through a raw-SQL reader. Postgres's text form
// (e.g. `2026-09-03 16:21:30.123+00`) is not strict ISO-8601, so this accepts
// any string rather than over-promising a format the reader never guarantees.
const timestampValue = z.union([z.string(), z.date()]);

export const oauthClientRowSchema = z.strictObject({
  clientId: z.string(),
  clientSecretHash: z.string().nullable(),
  clientName: z.string(),
  clientType: z.string(),
  tokenEndpointAuthMethod: z.string(),
  applicationType: z.string().nullable(),
  redirectUris: z.array(z.string()),
  grantTypes: z.array(z.string()),
  responseTypes: z.array(z.string()),
  clientIdMetadataUrl: z.string().nullable(),
  clientSecretExpiresAt: timestampValue.nullable(),
  createdAt: timestampValue,
  updatedAt: timestampValue,
});

export const oauthAuthorizationTransactionRowSchema = z.strictObject({
  transactionIdHash: z.string(),
  csrfTokenHash: z.string(),
  consentBindingHash: z.string(),
  userId: z.number().int(),
  clientId: z.string(),
  redirectUri: z.string(),
  codeChallenge: z.string(),
  codeChallengeMethod: z.string(),
  state: z.string().nullable(),
  issuer: z.string(),
  resource: z.string(),
  scope: z.string(),
  expiresAt: timestampValue,
  consumedAt: timestampValue.nullable(),
  createdAt: timestampValue,
});

export const oauthCodeRowSchema = z.strictObject({
  codeHash: z.string(),
  clientId: z.string(),
  userId: z.number().int(),
  redirectUri: z.string(),
  codeChallenge: z.string(),
  codeChallengeMethod: z.string(),
  scope: z.string().nullable(),
  state: z.string().nullable(),
  resource: z.string(),
  expiresAt: timestampValue,
  usedAt: timestampValue.nullable(),
  createdAt: timestampValue,
});

export const oauthAccessTokenRowSchema = z.strictObject({
  accessTokenHash: z.string(),
  clientId: z.string(),
  userId: z.number().int(),
  scope: z.string().nullable(),
  resource: z.string(),
  expiresAt: timestampValue,
  revokedAt: timestampValue.nullable(),
  createdAt: timestampValue,
});

export const oauthRefreshTokenRowSchema = z.strictObject({
  refreshTokenHash: z.string(),
  clientId: z.string(),
  userId: z.number().int(),
  scope: z.string().nullable(),
  resource: z.string(),
  accessTokenHash: z.string(),
  familyId: z.string(),
  expiresAt: timestampValue,
  revokedAt: timestampValue.nullable(),
  createdAt: timestampValue,
});
