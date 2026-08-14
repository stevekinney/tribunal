import { bigint, index, pgTable, text } from 'drizzle-orm/pg-core';

export const repository = pgTable(
  'repository',
  {
    id: bigint('id', { mode: 'number' }).primaryKey(), // GitHub repo ID (natural key)
    owner: text('owner').notNull(),
    name: text('name').notNull(),
    /** Repository's default branch (e.g., 'main', 'master'). Synced from GitHub API. */
    defaultBranch: text('default_branch'),
    /** Latest commit SHA on the default branch. Populated organically via push webhooks. */
    commit: text('commit'),
    installationId: bigint('installation_id', { mode: 'number' }),
  },
  (table) => [
    index('repository_owner_name_idx').on(table.owner, table.name),
    index('repository_installation_idx').on(table.installationId),
  ],
);

export type Repository = typeof repository.$inferSelect;
export type NewRepository = typeof repository.$inferInsert;
