import { bigint, index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const repository = pgTable(
  'repository',
  {
    id: bigint('id', { mode: 'number' }).primaryKey(), // GitHub repo ID (natural key)
    owner: text('owner').notNull(),
    name: text('name').notNull(),
    /** Fully-qualified Git URI (e.g. "https://github.com/owner/name.git"). Nullable for incremental backfill. */
    uri: text('uri'),
    /** Repository's default branch (e.g., 'main', 'master'). Synced from GitHub API. */
    defaultBranch: text('default_branch'),
    /** Latest commit SHA on the default branch. Populated organically via push webhooks. */
    commit: text('commit'),
    installationId: bigint('installation_id', { mode: 'number' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('repository_owner_name_idx').on(table.owner, table.name),
    index('repository_installation_idx').on(table.installationId),
    index('repository_uri_idx').on(table.uri),
  ],
);

export type Repository = typeof repository.$inferSelect;
export type NewRepository = typeof repository.$inferInsert;
