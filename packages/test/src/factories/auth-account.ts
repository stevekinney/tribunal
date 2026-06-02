/**
 * Authentication account factory for creating test auth accounts.
 */
import { authAccount } from '@tribunal/database/schema';
import type { AuthAccount } from '@tribunal/database/schema';
import type { Database } from './core';
import { generateId } from './core';

export type AuthenticationAccountFactoryInput = Partial<{
  userId: number;
  provider: 'github';
  providerUserId: string;
  providerUsername: string | null;
  email: string | null;
}>;

export interface AuthenticationAccountFactory {
  /** Create an auth account for a user */
  create(input: AuthenticationAccountFactoryInput & { userId: number }): Promise<AuthAccount>;
  /** Create a GitHub auth account */
  createGitHub(
    userId: number,
    overrides?: Partial<AuthenticationAccountFactoryInput>,
  ): Promise<AuthAccount>;
}

export function createAuthenticationAccountFactory(db: Database): AuthenticationAccountFactory {
  return {
    async create(input) {
      const id = generateId();
      const [account] = await db
        .insert(authAccount)
        .values({
          userId: input.userId,
          provider: input.provider ?? 'github',
          providerUserId: input.providerUserId ?? `provider-${id}`,
          providerUsername: input.providerUsername ?? null,
          email: input.email ?? null,
        })
        .returning();
      return account;
    },

    async createGitHub(userId, overrides = {}) {
      const id = generateId();
      return this.create({
        userId,
        provider: 'github',
        providerUserId: `${10000000 + id}`,
        providerUsername: overrides.providerUsername ?? `githubuser${id}`,
        email: overrides.email ?? null,
        ...overrides,
      });
    },
  };
}
