# OAuth Integration Patterns -- Reference

This reference contains all code examples, flow patterns, and detailed guidance for OAuth integrations. Sourced from the original `oauth-integrations.md` rule.

---

## Provider-specific OAuth state cookies

Use provider-specific cookie names for OAuth state to prevent collisions when users initiate multiple OAuth flows simultaneously:

```typescript
// WRONG: Shared cookie name across providers
const WORKSPACE_OAUTH_STATE_COOKIE = 'workspace_oauth_state';

// CORRECT: Provider-specific cookie names
const WORKSPACE_OAUTH_STATE_COOKIE = 'workspace_oauth_state_linear';
const WORKSPACE_OAUTH_STATE_COOKIE = 'workspace_oauth_state_slack';
const WORKSPACE_OAUTH_STATE_COOKIE = 'workspace_oauth_state_notion';
```

Without provider-specific names, concurrent OAuth flows will overwrite each other's state cookies, causing validation failures on callback.

---

## Compensating transactions with Neon HTTP

Since Neon HTTP doesn't support `db.transaction()`, use compensating deletes with specific error messages for orphaned record detection.

**Important:** When using upsert patterns, check if the row existed before the upsert. Only perform compensating deletes for **new** rows to avoid deleting existing data on failure:

```typescript
// Check if integration exists before upsert
const existingIntegration = await getWorkspaceIntegration(workspaceId, provider);

// ... perform upsert ...

} catch (credentialError) {
  // Only delete if this was a NEW integration
  if (!existingIntegration) {
    try {
      await db.delete(table.workspaceIntegration).where(eq(...));
    } catch (cleanupError) {
      console.error('CRITICAL: Orphaned integration:', { integrationId });
      return {
        success: false,
        error: `Failed to connect and cleanup failed. Orphaned ID: ${id}`,
      };
    }
  }
  throw credentialError;
}
```

---

## Revert status on credential failure

When an integration update or reauth changes the status to `'active'` but the subsequent credential operation fails, **always revert the status to its previous value**. Otherwise the UI shows "Connected" while no valid credentials exist:

```typescript
// Store previous state before updating
const previousStatus = existingIntegration.status;
const previousStatusReason = existingIntegration.statusReason;

// Update integration to active
await db.update(table.workspaceIntegration).set({ status: 'active', ... });

try {
  // Upsert credential
  await db.insert(table.integrationCredential).values({ ... }).onConflictDoUpdate({ ... });
} catch (credentialError) {
  // CRITICAL: Revert status to prevent active-without-credentials state
  await db.update(table.workspaceIntegration).set({
    status: previousStatus,
    statusReason: previousStatusReason,
    updatedAt: new Date(),
  }).where(eq(table.workspaceIntegration.id, integration.id));

  throw credentialError;
}
```

This pattern applies to both `connectWorkspaceIntegration` (for existing integrations) and `reauthWorkspaceIntegration`.

---

## Upsert for reauthorization flows

When reauthorizing integrations, use upsert (insert-on-conflict-update) instead of update alone. A revoked integration may have had its credentials deleted, making update a no-op:

```typescript
// WRONG: Update assumes credential row exists
await db
  .update(table.integrationCredential)
  .set({ accessToken: encrypted })
  .where(eq(table.integrationCredential.workspaceIntegrationId, id));

// CORRECT: Upsert handles missing credential row
await db
  .insert(table.integrationCredential)
  .values({ workspaceIntegrationId: id, accessToken: encrypted })
  .onConflictDoUpdate({
    target: table.integrationCredential.workspaceIntegrationId,
    set: { accessToken: encrypted, updatedAt: new Date() },
  });
```

---

## Status mapping in UI

Map all non-functional statuses to appropriate UI states. Revoked integrations have no credentials and should show "disconnected" (with reconnect action), not "connected":

```typescript
function getIntegrationCardStatus(integration): IntegrationCardStatus {
  if (!integration) return 'disconnected';
  if (integration.status === 'invalid') return 'invalid';
  if (integration.status === 'revoked') return 'disconnected'; // Credentials cleared
  return 'connected';
}
```

---

## Avoid unnecessary type casts

When Zod validation produces a typed result, use it directly. Casting to `Record<string, unknown>` loses type safety:

```typescript
// WRONG: Cast loses validated type info
const serviceAccount = validation.data;
json: serviceAccount as Record<string, unknown>,

// CORRECT: Use validated type directly
const serviceAccount = validation.data;
json: serviceAccount,
```

---

## Validate policy constraints in reauth

When reauthorizing integrations, apply the same validation as the initial connect. For example, if `providerPolicy[provider].requiresAccountId` is true, validate `providerAccountId` in both `connectWorkspaceIntegration` and `reauthWorkspaceIntegration`:

```typescript
export async function reauthWorkspaceIntegration(...) {
  const policy = providerPolicy[provider];
  if (policy.requiresAccountId && !providerAccountId) {
    return { success: false, error: `Provider ${provider} requires a provider account ID` };
  }
  // ...
}
```

---

## Service account schema validation

Make `token_uri` required in Google service account schemas -- it's needed for OAuth token exchange and making it optional allows invalid JSON to be stored:

```typescript
const serviceAccountSchema = z.object({
  type: z.literal('service_account'),
  // ... other required fields ...
  token_uri: z.string().url(), // Required for service account auth
  // optional fields...
});
```

---

## Batch database operations

When syncing many resources, batch `Promise.all` operations to avoid overwhelming the DB connection pool:

```typescript
const BATCH_SIZE = 20;
for (let i = 0; i < resources.length; i += BATCH_SIZE) {
  const batch = resources.slice(i, i + BATCH_SIZE);
  await Promise.all(batch.map((r) => db.insert(...)));
}
```

---

## Error logging in catch blocks

Always capture error details in catch blocks for debugging. Use structured logging with error messages:

```typescript
} catch (e) {
  console.error('Failed to sync resources:', {
    workspaceId,
    provider,
    error: e instanceof Error ? e.message : 'Unknown error',
  });
  return { success: false, error: 'Failed to sync resources' };
}
```

---

## Runtime type validation for external API responses

When accessing raw data from external OAuth responses, use runtime type guards instead of type assertions:

```typescript
// WRONG: Type assertion without validation
const tokenData = tokens.data as { workspace_id?: string };

// CORRECT: Runtime validation
const tokenData: unknown = tokens.data;
let providerAccountId: string | undefined;

if (
  tokenData &&
  typeof tokenData === 'object' &&
  'workspace_id' in tokenData &&
  typeof (tokenData as Record<string, unknown>).workspace_id === 'string'
) {
  providerAccountId = (tokenData as Record<string, unknown>).workspace_id as string;
}
```

---

## Svelte 5 icon types

Use `Component<{ class?: string }>` for icon components in Svelte 5, not the deprecated `ComponentType<SvelteComponent>`:

```typescript
import type { Component } from 'svelte';

type IconComponent = Component<{ class?: string }>;
```

---

## User-facing error messages

Never expose internal IDs (database IDs, integration IDs) in error messages returned to users. Log internal details for debugging but return user-friendly messages:

```typescript
// WRONG: Exposes internal implementation details
return {
  success: false,
  error: `Failed to connect and cleanup failed. Orphaned ID: ${integration.id}`,
};

// CORRECT: User-friendly message; internal ID logged separately
console.error('CRITICAL: Orphaned integration:', { integrationId: integration.id });
return {
  success: false,
  error:
    'Failed to connect integration and clean up temporary data. Please try again or contact support.',
};
```

Similarly, don't expose raw Zod validation errors to users -- they can reveal internal field names:

```typescript
// WRONG: Exposes internal field names
return fail(400, {
  error: `Invalid service account JSON: ${validation.error.issues.map((i) => i.message).join(', ')}`,
});

// CORRECT: Log detailed errors, return user-friendly message
console.error('[Google Drive Connect] Validation failed:', validation.error);
return fail(400, {
  error:
    'Invalid service account JSON. Please paste the complete key file downloaded from Google Cloud and try again.',
});
```

---

## GraphQL response validation

When calling GraphQL APIs, always validate the response structure before accessing nested fields. GraphQL can return partial data with errors:

```typescript
interface LinearOrganizationResponse {
  data?: {
    viewer?: {
      organization?: { id?: string } | null;
    } | null;
  } | null;
  errors?: Array<{ message: string }>;
}

const data = (await response.json()) as LinearOrganizationResponse;

// Check for errors first
if (data.errors?.length) {
  throw new Error(`Linear GraphQL error: ${data.errors[0].message}`);
}

// Validate expected data exists
const organizationId = data.data?.viewer?.organization?.id;
if (!organizationId) {
  throw new Error('Linear API returned unexpected response: missing organization ID');
}
```

---

## Use enum values from schema

Don't duplicate enum values in multiple places -- import them from the database schema to prevent drift:

```typescript
// WRONG: Duplicated list that can drift from schema
const validProviders: IntegrationProvider[] = ['linear', 'slack', 'notion', 'google_drive'];

// CORRECT: Use enum values from schema
import { integrationProviderEnum } from '$lib/server/database/schema';
const validProviders = integrationProviderEnum.enumValues;
```

---

## Clear resources on provider account change

When reauthorizing an integration, if the `providerAccountId` changes (user switched to a different external account), clear all existing resources. Old resources reference external IDs from the previous account and will cause API failures:

```typescript
const providerAccountChanged =
  providerAccountId !== null &&
  integration.providerAccountId !== null &&
  providerAccountId !== integration.providerAccountId;

if (providerAccountChanged) {
  console.warn('[Integration] Provider account changed, clearing stale resources:', {
    oldProviderAccountId: integration.providerAccountId,
    newProviderAccountId: providerAccountId,
  });
  await db
    .delete(table.workspaceIntegrationResource)
    .where(eq(table.workspaceIntegrationResource.workspaceIntegrationId, integration.id));
}
```

---

## Generic resource labels for multi-type providers

Providers can have multiple resource types (e.g., Linear has `team` and `project`, Google Drive has `folder` and `drive`). Use generic "resource/resources" labels instead of provider-specific ones:

```typescript
// WRONG: Assumes one resource type per provider
const resourceLabels: Record<string, [string, string]> = {
  linear: ['team', 'teams'], // But Linear also has projects!
};

// CORRECT: Use generic label since counts include all types
export function formatResourceCount(count: number): string {
  return `${count} ${count === 1 ? 'resource' : 'resources'}`;
}
```

---

## Treat stale selections as changes

When building resource selection UIs, if stale/inaccessible resources exist in the server state, treat them as pending changes even if the user hasn't modified the selection:

```typescript
// WRONG: Only compares current selection to filtered server state
const hasChanges = $derived(
  JSON.stringify([...selectedIds].sort()) !==
    JSON.stringify([...data.selectedIds].filter((id) => availableIds.has(id)).sort()),
);

// CORRECT: Include stale selections as changes
const hasSelectionChanges = $derived(/* comparison above */);
const hasChanges = $derived(hasSelectionChanges || staleSelections.length > 0);
```

Also ensure the UI provides a save path when all selected resources become inaccessible (empty available list but non-empty stale list).

---

## Enforce pagination limits inside the loop

When paginating API results with a safety limit, check the limit **inside** the results loop, not just after processing a full page:

```typescript
// WRONG: Can exceed limit (e.g., 450 -> 550 after 100-item page)
for (const result of response.results) {
  items.push(processItem(result));
}
if (items.length >= MAX_LIMIT) break;

// CORRECT: Check inside loop, exit both loops when hit
for (const result of response.results) {
  items.push(processItem(result));
  if (items.length >= MAX_LIMIT) {
    truncated = true;
    break;
  }
}
if (truncated) break;
```

---

## Map all status reasons to error messages

When a provider marks an integration invalid with a specific `statusReason`, ensure the connections page error message switch covers all values. Common status reasons to handle:

- `token_invalid` -- Token expired or revoked
- `invalid_grant` -- OAuth grant revoked or permissions changed (common on 403)
- `revoked` -- Access explicitly revoked
- `missing_scopes` -- Required scopes not granted

---

## Propagate status reasons through validation results

When a token validation function marks an integration invalid with different status reasons (e.g., `token_invalid` for 401, `invalid_grant` for 403), include the `statusReason` in the return type so callers can show appropriate error messages:

```typescript
// WRONG: Only returns valid/invalid, loses reason information
export type TokenValidationResult = { valid: true; workspaceName?: string } | { valid: false };

// CORRECT: Include statusReason in invalid result
export type TokenValidationResult =
  | { valid: true; workspaceName?: string }
  | { valid: false; statusReason: string };
```

Also provide a helper function to detect auth errors from external SDK calls:

```typescript
export type AuthErrorResult =
  | { isAuthError: true; statusReason: 'token_invalid' | 'invalid_grant' }
  | { isAuthError: false };

export function detectAuthError(e: unknown): AuthErrorResult {
  const error = e as { status?: number; code?: string; message?: string };
  if (error.status === 401 || error.code === 'unauthorized') {
    return { isAuthError: true, statusReason: 'token_invalid' };
  }
  if (error.status === 403) {
    return { isAuthError: true, statusReason: 'invalid_grant' };
  }
  return { isAuthError: false };
}
```

---

## IDOR prevention for workspace-scoped resources

Functions that mutate resources by external ID (like `linearWebhookId`) must verify workspace ownership to prevent cross-workspace access. Never trust caller-provided IDs without validation:

```typescript
// WRONG: IDOR vulnerability -- any workspace can access any webhook
export async function disableLinearWebhook(linearWebhookId: string): Promise<void> {
  await db
    .update(table.linearWebhook)
    .set({ enabled: false })
    .where(eq(table.linearWebhook.linearWebhookId, linearWebhookId));
}

// CORRECT: Verify workspace ownership via JOIN before mutation
export async function disableLinearWebhook(
  workspaceId: number,
  linearWebhookId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  // Verify ownership through workspace_integration FK
  const [webhook] = await db
    .select({ id: table.linearWebhook.id, workspaceId: table.workspaceIntegration.workspaceId })
    .from(table.linearWebhook)
    .innerJoin(
      table.workspaceIntegration,
      eq(table.linearWebhook.workspaceIntegrationId, table.workspaceIntegration.id),
    )
    .where(eq(table.linearWebhook.linearWebhookId, linearWebhookId));

  if (!webhook || webhook.workspaceId !== workspaceId) {
    console.warn('[Webhook] Unauthorized access attempt:', { attemptedWorkspaceId: workspaceId });
    return { ok: false, error: 'Webhook not found' }; // Use NOT_FOUND to avoid leaking existence
  }

  await db
    .update(table.linearWebhook)
    .set({ enabled: false })
    .where(eq(table.linearWebhook.id, webhook.id)); // Use PK after validation

  return { ok: true };
}
```

Also ensure server endpoints pass `workspaceId` to service functions that require it.

---

## Multi-credential integration flows

When integrations support multiple credential roles (e.g., `app_actor` for runtime + `webhook_admin` for admin operations):

### Admin OAuth requires existing integration

Don't create a new integration from an admin OAuth flow. The admin credential is supplementary -- require the base integration to exist:

```typescript
const existingIntegration = await getWorkspaceIntegration(workspaceId, 'linear');
if (!existingIntegration) {
  // Block admin OAuth without base integration
  redirect(302, `/workspaces/${handle}/connections?error=missing_integration`);
}
```

### Clean up external resources before cascade delete

When disconnecting an integration, delete external API resources (webhooks, etc.) BEFORE the cascade delete removes credentials:

```typescript
export async function disconnectWorkspaceIntegration(...) {
  // Provider-specific cleanup BEFORE cascade delete
  if (provider === 'linear') {
    const [adminCredential] = await db.select().from(table.integrationCredential)
      .where(and(eq(..., integration.id), eq(..., 'webhook_admin'), eq(..., true)));
    const accessToken = adminCredential?.accessToken ? decrypt(...) : null;
    await cleanupLinearWebhooksForIntegration(integration.id, accessToken);
  }

  // Now safe to cascade delete -- external resources already cleaned
  await db.delete(table.workspaceIntegration).where(eq(..., integration.id));
}
```

---

## Webhook secret lookup priority

When multiple webhooks can match an incoming event (e.g., team-specific AND org-wide), prefer exact matches to avoid signature verification failures:

```typescript
// WRONG: OR clause returns arbitrary match
const [webhook] = await db.select().from(table.linearWebhook).where(
  or(eq(table.linearWebhook.teamId, teamId), eq(table.linearWebhook.allPublicTeams, true))
);

// CORRECT: Try exact match first, fall back to wildcard
let webhook;
if (teamId) {
  [webhook] = await db.select().from(table.linearWebhook)
    .where(and(..., eq(table.linearWebhook.teamId, teamId)));
}
if (!webhook) {
  [webhook] = await db.select().from(table.linearWebhook)
    .where(and(..., eq(table.linearWebhook.allPublicTeams, true)));
}
```

---

## Supplementary credentials don't change integration status

When adding supplementary credentials (like `webhook_admin` on top of `app_actor`), do NOT modify the integration's status or providerAccountId. The integration's health depends on the primary credential:

```typescript
export async function reauthWorkspaceIntegration(..., options) {
  const role = options?.role ?? 'app_actor';
  const isSupplementaryRole = role !== 'app_actor';

  if (isSupplementaryRole) {
    // Only update timestamp -- don't touch status or providerAccountId
    await db.update(table.workspaceIntegration)
      .set({ updatedAt: new Date() })
      .where(eq(..., integration.id));
  } else {
    // Full reauth: update status, providerAccountId, clear resources if needed
    await db.update(table.workspaceIntegration)
      .set({ status: 'active', providerAccountId, ... });
  }
}
```

**Why:** If `app_actor` is invalid but you add `webhook_admin`, setting `status: 'active'` makes the UI show "connected" while all runtime operations fail.

---

## Verify organization matches before adding supplementary credentials

When adding supplementary credentials via OAuth, verify the authenticated organization matches the existing integration's `providerAccountId`. A mismatch leaves the integration broken -- credentials from different orgs can't work together:

```typescript
// In admin OAuth callback
const existingIntegration = await getWorkspaceIntegration(workspaceId, 'linear');

// Verify org matches before proceeding
if (
  existingIntegration.providerAccountId &&
  existingIntegration.providerAccountId !== providerAccountId
) {
  console.error('[Admin OAuth] Organization mismatch:', {
    existingOrgId: existingIntegration.providerAccountId,
    attemptedOrgId: providerAccountId,
  });
  redirect(302, `/workspaces/${handle}/connections?error=org_mismatch&provider=linear_admin`);
}
```

---

## Validate external API response data before storing

Don't silently store empty/default values when external APIs return unexpected responses. Fail explicitly to surface issues early:

```typescript
// WRONG: Silently stores empty string, causes signature verification failures later
secret: encrypt(webhook.secret ?? ''),

// CORRECT: Validate and fail early with cleanup
if (!webhook.secret) {
  console.error('[Webhooks] API returned webhook without secret:', { webhookId });
  try { await client.deleteWebhook(webhook.id); } catch {} // Cleanup
  throw new Error('API returned webhook without signing secret');
}
secret: encrypt(webhook.secret),
```

## See also

- `{baseDir}/rules/oauth-integrations.md` (security directives, provider bullets)
- `database-operations` skill (Neon HTTP constraints, compensating deletes)
