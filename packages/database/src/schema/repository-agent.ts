import { bigint, index, pgTable, primaryKey, text } from 'drizzle-orm/pg-core';
import { agent } from './agent';
import { repository } from './repository';

export const repositoryAgent = pgTable(
  'repository_agent',
  {
    repositoryId: bigint('repository_id', { mode: 'number' })
      .notNull()
      .references(() => repository.id, { onDelete: 'cascade' }),
    agentId: text('agent_id')
      .notNull()
      .references(() => agent.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.repositoryId, table.agentId] }),
    index('repository_agent_agent_idx').on(table.agentId),
  ],
);

export type RepositoryAgent = typeof repositoryAgent.$inferSelect;
export type NewRepositoryAgent = typeof repositoryAgent.$inferInsert;
