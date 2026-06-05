/**
 * Core utilities shared by all factory modules.
 */
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import type * as schema from '@tribunal/database/schema';

export type Database = PgliteDatabase<typeof schema>;

// Counter for generating unique IDs
let idCounter = 1;

/**
 * Generates a unique incrementing ID for test entities.
 */
export const generateId = () => idCounter++;

/**
 * Reset the ID counter (call this in beforeEach if you want predictable IDs)
 */
export function resetIdCounter(): void {
  idCounter = 1;
}
