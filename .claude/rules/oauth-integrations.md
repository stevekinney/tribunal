---
paths:
  - src/routes/connect/**
  - src/lib/server/workspace-integrations.ts
  - src/lib/server/linear-webhooks.ts
---

# OAuth and workspace integration patterns

Before editing paths in this rule, load `$github-integration-rules` and apply its constraints.
For code examples and flow diagrams, see `github-integration-rules` references.

## Security directives

- **Token storage**: Always encrypt tokens before storing; never log or expose raw tokens.
- **PKCE / state parameter**: Use provider-specific OAuth state cookie names (`workspace_oauth_state_<provider>`) to prevent collisions across concurrent flows.
- **IDOR prevention**: Verify workspace ownership via JOIN before mutating any resource by external ID. Use `NOT_FOUND` responses to avoid leaking existence.
- **User-facing errors**: Never expose internal IDs, raw Zod errors, or database details. Log internally; return friendly messages.
- **Validate before storing**: Fail explicitly when external APIs return empty/default values (e.g., webhook without secret). Do not silently store fallback values.

## Credential handling

- **Compensating transactions**: Neon HTTP has no `db.transaction()`. Check existence before upsert; only clean up new rows on failure.
- **Status revert**: Store previous status before updating to `'active'`. Revert if credential write fails.
- **Upsert for reauth**: Use insert-on-conflict-update -- revoked integrations may have had credentials deleted.
- **Supplementary credentials** (e.g., `webhook_admin`): Do not change integration status or `providerAccountId` when adding non-primary roles.
- **Organization match**: Verify `providerAccountId` matches before adding supplementary credentials via OAuth.
- **Clear resources on account change**: If `providerAccountId` changes during reauth, delete stale resources referencing the old account.

## Provider-specific notes

- **Linear**: Supports multi-credential roles (`app_actor` + `webhook_admin`). Admin OAuth requires existing base integration. Clean up webhooks before cascade delete. Webhook secret lookup prefers exact team match over wildcard.
- **Notion**: Extract `workspace_id` from token response using runtime type guards, not type assertions.
- **Google Drive**: `token_uri` is required in service account schemas. Validate the full JSON before storing.
- **All providers**: Import `integrationProviderEnum.enumValues` from schema instead of duplicating provider lists.

## Token validation

- **Propagate status reasons**: Return `statusReason` in validation results (`token_invalid`, `invalid_grant`, `revoked`, `missing_scopes`) so callers display correct error messages.
- **Auth error detection helper**: Provide `detectAuthError(e)` to classify 401 as `token_invalid` and 403 as `invalid_grant`.
- **Map all status reasons**: Connections page error switch must cover every `statusReason` value.

## Resource sync and UI

- **Batch operations**: Use `Promise.all` with `BATCH_SIZE = 20` to avoid overwhelming connection pool.
- **Pagination limits**: Check inside the results loop, not after processing a full page.
- **Generic resource labels**: Use "resource/resources" instead of provider-specific type names (providers can have multiple types).
- **Stale selections**: Treat stale/inaccessible resources as pending changes so users can clear them by saving.
- **Status mapping**: Map `revoked` to `disconnected` in UI (credentials are cleared). Map `invalid` to `invalid`.

## GraphQL responses

- Validate response structure before accessing nested fields.
- Check `errors` array first; then confirm expected data exists.

## General patterns

- **Policy constraints in reauth**: Apply same validations as initial connect (e.g., `requiresAccountId`).
- **Svelte 5 icons**: Use `Component<{ class?: string }>`, not deprecated `ComponentType<SvelteComponent>`.
- **Error logging**: Use structured logging with `workspaceId`, `provider`, and error message in catch blocks.
- **Avoid unnecessary casts**: Use Zod validated types directly instead of casting to `Record<string, unknown>`.
