/**
 * Core utilities shared by all factory modules.
 */
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import type * as schema from '@tribunal/database/schema';
import { encodeBase64url } from '@oslojs/encoding';

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

/**
 * Generates a random session token (same format as production)
 */
export function generateSessionToken(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return encodeBase64url(bytes);
}

/**
 * Hashes a token using SHA-256 (same as production)
 */
export async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = new Uint8Array(hashBuffer);
  return encodeBase64url(hashArray);
}
