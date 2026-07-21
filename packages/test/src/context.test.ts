import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createTestContext, type TestContext } from './context';

describe('createTestContext', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext();
  });

  afterAll(async () => {
    await ctx.close();
  });

  afterEach(async () => {
    await ctx.reset();
  });

  it('exposes a working database and factories', async () => {
    expect(ctx.db).toBeDefined();
    expect(ctx.factories.user).toBeDefined();
  });

  describe('createAuthenticatedUser', () => {
    it('creates a user with a generated Neon Auth id when no options are given', async () => {
      const { user, neonAuthUserId, oauthConnection } = await ctx.createAuthenticatedUser();

      expect(user.neonAuthUserId).toBe(neonAuthUserId);
      expect(neonAuthUserId).toMatch(/^neon-user-/);
      expect(oauthConnection).toBeUndefined();
    });

    it('honors a provided username and neonAuthUserId', async () => {
      const { user, neonAuthUserId } = await ctx.createAuthenticatedUser({
        username: 'authenticated-user',
        neonAuthUserId: 'neon-fixed-id',
      });

      expect(user.username).toBe('authenticated-user');
      expect(neonAuthUserId).toBe('neon-fixed-id');
    });

    it('creates a linked OAuth connection when withOAuth is true', async () => {
      const { user, oauthConnection } = await ctx.createAuthenticatedUser({ withOAuth: true });

      expect(oauthConnection).toBeDefined();
      expect(oauthConnection?.userId).toBe(user.id);
      expect(oauthConnection?.provider).toBe('github');
      expect(oauthConnection?.scope).toBe('read:user,repo');
    });

    it('honors a custom oauthScopes value when withOAuth is true', async () => {
      const { oauthConnection } = await ctx.createAuthenticatedUser({
        withOAuth: true,
        oauthScopes: 'read:org',
      });

      expect(oauthConnection?.scope).toBe('read:org');
    });
  });

  describe('reset', () => {
    it('clears created users and resets the id counter for subsequent tests', async () => {
      const first = await ctx.createAuthenticatedUser({ username: 'reset-check' });

      await ctx.reset();

      const second = await ctx.factories.user.create();
      expect(second.id).toBe(first.user.id);
    });
  });
});
