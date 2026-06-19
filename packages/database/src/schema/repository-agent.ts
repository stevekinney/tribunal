import { bigint, index, integer, pgTable, primaryKey, text } from 'drizzle-orm/pg-core';
import { agent } from './agent';
import { repository } from './repository';
import { user } from './user';

export const repositoryAgent = pgTable(
  'repository_agent',
  {
    userId: integer('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    repositoryId: bigint('repository_id', { mode: 'number' })
      .notNull()
      .references(() => repository.id, { onDelete: 'cascade' }),
    agentId: text('agent_id')
      .notNull()
      .references(() => agent.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.repositoryId, table.agentId] }),
    index('repository_agent_repository_idx').on(table.repositoryId),
    index('repository_agent_agent_idx').on(table.agentId),
  ],
);

export type RepositoryAgent = typeof repositoryAgent.$inferSelect;
export type NewRepositoryAgent = typeof repositoryAgent.$inferInsert;
