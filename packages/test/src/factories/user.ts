/**
 * User factory for creating test users.
 */
import { user as userTable } from '@tribunal/database/schema';
import type { User } from '@tribunal/database/schema';
import type { Database } from './core';
import { generateId } from './core';

export type UserFactoryInput = Partial<{
  username: string;
  name: string | null;
  avatarUrl: string | null;
  email: string | null;
  isPlatformAdministrator: boolean;
}>;

export interface UserFactory {
  /** Create a user with optional overrides */
  create(input?: UserFactoryInput): Promise<User>;
  /** Create multiple users */
  createMany(count: number, input?: UserFactoryInput): Promise<User[]>;
}

export function createUserFactory(db: Database): UserFactory {
  return {
    async create(input = {}) {
      const id = generateId();
      const [user] = await db
        .insert(userTable)
        .values({
          username: input.username ?? `testuser${id}`,
          name: input.name ?? `Test User ${id}`,
          avatarUrl: input.avatarUrl ?? `https://avatars.githubusercontent.com/u/${id}`,
          email: input.email ?? null,
          isPlatformAdministrator: input.isPlatformAdministrator ?? false,
        })
        .returning();
      return user;
    },
    async createMany(count, input = {}) {
      const users: User[] = [];
      for (let i = 0; i < count; i++) {
        users.push(await this.create(input));
      }
      return users;
    },
  };
}
