/**
 * Session factory for creating test sessions.
 */
import { session } from '@tribunal/database/schema';
import type { Session } from '@tribunal/database/schema';
import type { Database } from './core';
import { generateSessionToken, hashToken } from './core';

export type SessionFactoryInput = Partial<{
  userId: number;
  expiresAt: Date;
}>;

export interface SessionFactory {
  /** Create a session for a user, returns both the session and the raw token */
  create(input: SessionFactoryInput & { userId: number }): Promise<{
    session: Session;
    token: string;
  }>;
}

export function createSessionFactory(db: Database): SessionFactory {
  return {
    async create(input) {
      const token = generateSessionToken();
      const tokenHash = await hashToken(token);
      const expiresAt = input.expiresAt ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

      const [createdSession] = await db
        .insert(session)
        .values({
          id: tokenHash,
          userId: input.userId,
          expiresAt,
        })
        .returning();

      return { session: createdSession, token };
    },
  };
}
