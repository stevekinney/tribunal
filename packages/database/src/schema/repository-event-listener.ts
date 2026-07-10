import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { agent } from './agent';
import { repository } from './repository';
import { user } from './user';

/**
 * A user-defined listener for GitHub webhook deliveries in a repository. When
 * an incoming `webhook_event` matches a listener's event type/action/filters,
 * an `event_listener_delivery` row is created to track dispatching the
 * selected agent with the listener's instructions.
 *
 * `agentId` cascades on agent delete rather than using `set null` + a CHECK:
 * a listener without an agent has nothing to run, so deleting the agent
 * deletes the listener outright instead of leaving a permanently
 * unexecutable row behind. Disabling an agent (`agent.enabled = false`)
 * is the soft path -- matching and dispatch both re-check `agent.enabled`
 * at their respective points in time, so a disabled agent simply stops
 * new dispatches without touching listener configuration.
 */
export const repositoryEventListener = pgTable(
  'repository_event_listener',
  {
    id: text('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    repositoryId: bigint('repository_id', { mode: 'number' })
      .notNull()
      .references(() => repository.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    eventType: text('event_type').notNull(),
    action: text('action'),
    // Named-field filters only -- exact match against normalized columns
    // already stored on `webhook_event` (ref, prNumber, issueNumber,
    // senderLogin). No JSONPath, no user-authored expressions. See
    // `parseEventListenerFilters` in @tribunal/github for the supported
    // shape.
    filtersJson: text('filters_json').notNull().default('{}'),
    agentId: text('agent_id')
      .notNull()
      .references(() => agent.id, { onDelete: 'cascade' }),
    instructionsMarkdown: text('instructions_markdown').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('repository_event_listener_user_idx').on(table.userId),
    index('repository_event_listener_repository_idx').on(table.repositoryId),
    index('repository_event_listener_agent_idx').on(table.agentId),
    index('repository_event_listener_repository_event_type_idx').on(
      table.repositoryId,
      table.eventType,
    ),
    check('repository_event_listener_name_not_blank_check', sql`length(trim(${table.name})) > 0`),
  ],
);

export type RepositoryEventListener = typeof repositoryEventListener.$inferSelect;
export type NewRepositoryEventListener = typeof repositoryEventListener.$inferInsert;
