/**
 * Re-export drizzle-orm query operators.
 *
 * Workers must import operators from here (not directly from 'drizzle-orm')
 * to ensure type compatibility with schema columns. Workers have a separate
 * node_modules/drizzle-orm copy for Docker deployment, and TypeScript treats
 * private properties in each copy as incompatible. Importing operators
 * through $lib ensures both operators and schema types resolve to the
 * same drizzle-orm instance.
 */
export {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNull,
  lt,
  lte,
  ne,
  not,
  notInArray,
  or,
  sql,
} from 'drizzle-orm';

export type { SQL } from 'drizzle-orm';
