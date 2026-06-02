/**
 * User API key factory for creating test API keys.
 */
import { userApiKey as userApiKeyTable } from '@tribunal/database/schema';
import type { UserApiKey } from '@tribunal/database/schema';
import type { Database } from './core';
import { generateId } from './core';

export type UserApiKeyFactoryInput = Partial<{
  userId: number;
  name: string;
  keyHash: string;
  keyPrefix: string;
  revoked: boolean;
  expiresAt: Date | null;
}>;

export interface UserApiKeyFactory {
  /** Create a user API key with optional overrides */
  create(input?: UserApiKeyFactoryInput): Promise<UserApiKey>;
  /** Create multiple user API keys */
  createMany(count: number, input?: UserApiKeyFactoryInput): Promise<UserApiKey[]>;
}

export function createUserApiKeyFactory(db: Database): UserApiKeyFactory {
  return {
    async create(input = {}) {
      const id = generateId();
      // Generate deterministic prefix based on id to avoid collisions
      const prefixHex = id.toString(16).padStart(12, '0').slice(-12);
      const defaultPrefix = `uak_${prefixHex}`;
      const defaultHash = `${'a'.repeat(64)}`; // Dummy SHA-256 hex (64 chars)

      const [apiKey] = await db
        .insert(userApiKeyTable)
        .values({
          userId: input.userId ?? 1, // Assumes user with id 1 exists or will be created
          name: input.name ?? `Test Key ${id}`,
          keyHash: input.keyHash ?? defaultHash,
          keyPrefix: input.keyPrefix ?? defaultPrefix,
          expiresAt: input.expiresAt ?? null,
          revokedAt: input.revoked ? new Date() : null,
        })
        .returning();
      return apiKey;
    },
    async createMany(count, input = {}) {
      const apiKeys: UserApiKey[] = [];
      for (let i = 0; i < count; i++) {
        apiKeys.push(await this.create(input));
      }
      return apiKeys;
    },
  };
}
