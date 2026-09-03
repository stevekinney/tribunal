import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDatabase, type TestDatabase } from '@tribunal/test/database';
import { runWithDatabase } from '$lib/server/database';
import { user } from '@tribunal/database/schema';
import type { AuthenticatedApplicationUser } from '$lib/server/auth/neon-session';

const validateNeonSessionFromToken = vi.fn();

vi.mock('$lib/server/auth/neon-session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/server/auth/neon-session')>();
  return { ...actual, validateNeonSessionFromToken };
});

const { identityFromUser, profileFromUser, resolveIdentityBinding, resolveUserProfile } =
  await import('./identity');

const applicationUser: AuthenticatedApplicationUser = {
  id: 42,
  username: 'octocat',
  name: 'Octo Cat',
  avatarUrl: 'https://example.com/a.png',
  email: 'octo@example.com',
  isPlatformAdministrator: false,
};

let testDatabase: TestDatabase;

beforeAll(async () => {
  testDatabase = await createTestDatabase();
});

afterAll(async () => {
  await testDatabase.close();
});

beforeEach(async () => {
  await testDatabase.reset();
  validateNeonSessionFromToken.mockReset();
});

describe('identityFromUser', () => {
  it('uses the integer user id as the subject and consent binding', () => {
    expect(identityFromUser(applicationUser)).toEqual({
      subjectId: '42',
      consentBinding: 'user:42',
    });
  });
});

describe('profileFromUser', () => {
  it('maps the application user to the engine profile shape', () => {
    expect(profileFromUser(applicationUser)).toEqual({
      id: '42',
      email: 'octo@example.com',
      name: 'Octo Cat',
      image: 'https://example.com/a.png',
      role: 'user',
    });
  });

  it('marks platform administrators as admin and falls back to username/empty email', () => {
    const admin = profileFromUser({
      ...applicationUser,
      name: null,
      email: null,
      isPlatformAdministrator: true,
    });
    expect(admin.role).toBe('admin');
    expect(admin.name).toBe('octocat');
    expect(admin.email).toBe('');
  });
});

describe('resolveIdentityBinding', () => {
  const requestWithCookie = (cookie?: string) =>
    new Request('http://localhost/oauth/authorize', {
      headers: cookie ? { cookie } : {},
    });

  it('returns null when no session cookie is present', async () => {
    await expect(resolveIdentityBinding(requestWithCookie())).resolves.toBeNull();
  });

  it('returns null when the cookie header lacks the session cookie', async () => {
    await expect(
      resolveIdentityBinding(requestWithCookie('other=1; another=2')),
    ).resolves.toBeNull();
  });

  it('returns null when the token is invalid', async () => {
    validateNeonSessionFromToken.mockRejectedValue(new Error('invalid'));
    await expect(
      resolveIdentityBinding(requestWithCookie('tribunal-neon-auth-token=bad')),
    ).resolves.toBeNull();
  });

  it('maps a valid session to the OAuth identity', async () => {
    validateNeonSessionFromToken.mockResolvedValue({
      user: applicationUser,
      neonSession: { neonAuthUserId: 'neon-sub', expiresAt: new Date() },
    });
    await expect(
      resolveIdentityBinding(requestWithCookie('tribunal-neon-auth-token=good; other=1')),
    ).resolves.toEqual({ subjectId: '42', consentBinding: 'user:42' });
  });
});

describe('resolveUserProfile', () => {
  it('rejects a malformed or out-of-range subject', async () => {
    await expect(resolveUserProfile('abc')).resolves.toBeNull();
    await expect(resolveUserProfile('0')).resolves.toBeNull();
    await expect(resolveUserProfile('9999999999')).resolves.toBeNull();
  });

  it('returns null when no user row matches', async () => {
    await runWithDatabase(testDatabase.db as never, async () => {
      await expect(resolveUserProfile('123')).resolves.toBeNull();
    });
  });

  it('resolves the profile for an existing user', async () => {
    await runWithDatabase(testDatabase.db as never, async () => {
      const [row] = await testDatabase.db
        .insert(user)
        .values({ username: 'octocat', email: 'octo@example.com', name: 'Octo Cat' })
        .returning({ id: user.id });
      const profile = await resolveUserProfile(String(row!.id));
      expect(profile).toMatchObject({ id: String(row!.id), email: 'octo@example.com' });
    });
  });
});
