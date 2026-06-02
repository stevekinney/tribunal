# Platform Admin Runbook

This document describes procedures for managing platform administrator access in Tribunal.

## Overview

Platform administrators have elevated privileges across Tribunal. Access is controlled by the `is_platform_admin` boolean column on the `user` table (exposed in code as the `isPlatformAdministrator` flag). All grant/revoke operations are logged to the `platform_admin_audit_log` table for accountability.

There is no admin UI. The flag is read by the `requirePlatformAdministrator` / `isPlatformAdministrator` helpers in server code, and granting or revoking access is done with direct SQL against the database, as documented below.

## Bootstrap: First Platform Admin

When setting up a new environment or recovering from a state with no admins, use SQL directly:

```sql
BEGIN;

UPDATE "user"
SET is_platform_admin = true
WHERE id = <userId>;

INSERT INTO platform_admin_audit_log (user_id, performed_by, action, reason)
VALUES (<userId>, NULL, 'granted', 'bootstrap: first platform admin');

COMMIT;
```

Setting `performed_by = NULL` indicates a bootstrap operation.

## Granting Admin Access

Use SQL directly and write an audit row in the same transaction:

```sql
BEGIN;

UPDATE "user"
SET is_platform_admin = true
WHERE id = <userId>;

INSERT INTO platform_admin_audit_log (user_id, performed_by, action, reason)
VALUES (<userId>, <performedByUserId>, 'granted', '<reason>');

COMMIT;
```

Requirements:

- `performed_by` should be an existing platform admin user id
- Always provide a clear operational reason
- Keep update + audit insert in one transaction

## Revoking Admin Access

Use SQL directly and write an audit row in the same transaction:

```sql
BEGIN;

UPDATE "user"
SET is_platform_admin = false
WHERE id = <userId>;

INSERT INTO platform_admin_audit_log (user_id, performed_by, action, reason)
VALUES (<userId>, <performedByUserId>, 'revoked', '<reason>');

COMMIT;
```

Requirements:

- `performed_by` should be an existing platform admin user id
- Always provide a clear operational reason
- Keep update + audit insert in one transaction

## Querying Audit Logs

View admin grant/revoke history:

```sql
-- All recent admin changes
SELECT
  pal.id,
  pal.action,
  pal.reason,
  pal.created_at,
  subject.username AS target_user,
  performer.username AS performed_by
FROM platform_admin_audit_log pal
JOIN "user" subject ON pal.user_id = subject.id
LEFT JOIN "user" performer ON pal.performed_by = performer.id
ORDER BY pal.created_at DESC
LIMIT 50;

-- All bootstrap operations (performed_by is null)
SELECT * FROM platform_admin_audit_log
WHERE performed_by IS NULL
ORDER BY created_at DESC;

-- History for a specific user
SELECT * FROM platform_admin_audit_log
WHERE user_id = <userId>
ORDER BY created_at DESC;
```

## Listing Current Admins

```sql
SELECT id, username, email
FROM "user"
WHERE is_platform_admin = true;
```

## Troubleshooting

### Lockout Recovery (No Admins Exist)

If no platform admins exist:

1. Identify a user to bootstrap as admin
2. Run the bootstrap SQL directly against the database (see "Bootstrap: First Platform Admin" above)

### Permission Denied Errors

If an admin gets "Platform admin access required":

1. Verify the user's `isPlatformAdministrator` flag in the database
2. Check if their session predates the flag being set (they may need to re-login)
3. Verify the session is not expired

### Audit Log Missing Entries

If audit entries are missing:

1. Check for database transaction rollbacks
2. Verify operational scripts executed both user update and audit insert
3. Look for application logs with correlation IDs

## Security Considerations

1. **Principle of Least Privilege**: Only grant admin to users who need it
2. **Audit Trail**: All changes are logged with reason and performer
3. **Bootstrap Security**: The bootstrap script should only be accessible to operators with database access
4. **Session Freshness**: Consider requiring re-authentication for admin operations in the future

## Related Files

- `packages/database/src/schema/user.ts` - `isPlatformAdministrator` flag, mapped to the `is_platform_admin` column with a partial index (`user_is_platform_admin_idx`) for admin lookups.
- `packages/database/drizzle/schema.ts` - `platformAdminAuditLog` definition for the `platform_admin_audit_log` table (columns: `user_id`, `performed_by`, `action`, `reason`, `created_at`). The table lives only in the introspected Drizzle schema; there is no hand-authored module under `packages/database/src/schema/`, and it is not re-exported from that directory's barrel.
- `packages/database/drizzle/0000_baseline.sql` - Baseline migration that creates `platform_admin_audit_log` with its `platform_admin_action` enum, indexes, and foreign keys (`user_id` cascades on delete; `performed_by` is set to null on delete).
- `packages/schemas/src/platform-administrator-audit-log.ts` - Generated Zod insert/select schemas for audit-log rows (`action` is `'granted' | 'revoked'`).
- `applications/web/src/lib/server/auth/platform-administrator.ts` - `requirePlatformAdministrator` (throws 403) and `isPlatformAdministrator` authorization helpers.
