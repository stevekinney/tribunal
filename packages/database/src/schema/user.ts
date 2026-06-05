import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';

export const user = pgTable(
  'user',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    username: text('username').notNull(), // Handle for user profile URLs
    neonAuthUserId: text('neon_auth_user_id'), // Managed Neon Auth user id
    email: text('email'), // Primary email for notifications/invitations
    name: text('name'),
    avatarUrl: text('avatar_url'),
    isPlatformAdministrator: boolean('is_platform_admin').notNull().default(false),
  },
  (table) => [
    // Case-insensitive unique index on email (only for non-null values)
    uniqueIndex('user_email_lower_idx')
      .on(sql`lower(${table.email})`)
      .where(sql`${table.email} IS NOT NULL`),
    uniqueIndex('user_neon_auth_user_id_idx')
      .on(table.neonAuthUserId)
      .where(sql`${table.neonAuthUserId} IS NOT NULL`),
    // Case-insensitive unique index on username
    uniqueIndex('user_username_lower_idx').on(sql`lower(${table.username})`),
    // Username format: 3-39 chars, alphanumeric and hyphens, no leading/trailing hyphen
    check(
      'user_username_format',
      sql`${table.username} ~ '^[a-z0-9][a-z0-9-]{1,37}[a-z0-9]$' OR ${table.username} ~ '^[a-z0-9]{3}$'`,
    ),
    // Disallow reserved usernames (sync with RESERVED_HANDLES in handle-generator.ts)
    check(
      'user_username_not_reserved',
      sql`lower(${table.username}) NOT IN (
        'admin', 'administrator', 'root', 'system', 'support', 'help',
        'api', 'www', 'app', 'auth', 'oauth', 'callback', 'login', 'logout', 'signup', 'signin', 'register', 'settings', 'dashboard', 'profile', 'account', 'user', 'users',
        'mail', 'email', 'billing', 'payments', 'docs', 'blog', 'status', 'cdn', 'static', 'assets',
        'tribunal', 'about', 'team', 'legal', 'privacy', 'terms', 'contact',
        'new', 'create', 'edit', 'delete', 'workspace', 'workspaces', 'project', 'projects', 'invitation', 'invitations', 'connection', 'connections', 'connect', 'member', 'members', 'security', 'onboarding', 'reauth', 'link', 'unlink'
      )`,
    ),
    // Partial index for efficient platform admin queries
    index('user_is_platform_admin_idx')
      .on(table.id)
      .where(sql`${table.isPlatformAdministrator} = true`),
  ],
);

export type User = typeof user.$inferSelect;
export type NewUser = typeof user.$inferInsert;
