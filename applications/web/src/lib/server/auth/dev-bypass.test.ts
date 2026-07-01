import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  env: {
    DEV_AUTH_BYPASS: undefined as string | undefined,
    DEV_AUTH_BYPASS_USER: undefined as string | undefined,
    E2E_TEST_MODE: undefined as string | undefined,
  },
  environment: { dev: true, building: false },
  // Row returned by the mocked select after the mocked insert "runs". Tests
  // set this to simulate a fresh insert vs. an existing (possibly non-bypass) row.
  selectedRow: null as { username: string; neonAuthUserId: string } | null,
  onConflictDoNothing: vi.fn(),
}));

vi.mock('$env/dynamic/private', () => ({ env: mocks.env }));

vi.mock('$app/environment', () => ({
  get dev() {
    return mocks.environment.dev;
  },
  get building() {
    return mocks.environment.building;
  },
}));

// Chainable stub matching the query-builder shape resolveBypassUser uses:
// db.insert(...).values(...).onConflictDoNothing() and
// db.select(...).from(...).where(...).limit(1).
vi.mock('$lib/server/database', () => ({
  db: {
    insert: () => ({ values: () => ({ onConflictDoNothing: mocks.onConflictDoNothing }) }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => (mocks.selectedRow ? [mocks.selectedRow] : []),
        }),
      }),
    }),
  },
}));

import {
  assertDevAuthBypassNotInProduction,
  bypassUsername,
  devAuthBypassHandle,
  isDevAuthBypassEnabled,
} from './dev-bypass';

describe('assertDevAuthBypassNotInProduction', () => {
  it('throws when the flag is armed outside a dev runtime', () => {
    expect(() => assertDevAuthBypassNotInProduction({ dev: false, DEV_AUTH_BYPASS: '1' })).toThrow(
      /Refusing to start/,
    );
  });

  it('allows the flag in a dev runtime', () => {
    expect(() =>
      assertDevAuthBypassNotInProduction({ dev: true, DEV_AUTH_BYPASS: '1' }),
    ).not.toThrow();
  });

  it('allows a non-dev runtime when the flag is unset', () => {
    expect(() =>
      assertDevAuthBypassNotInProduction({ dev: false, DEV_AUTH_BYPASS: undefined }),
    ).not.toThrow();
  });
});

describe('isDevAuthBypassEnabled', () => {
  beforeEach(() => {
    mocks.env.DEV_AUTH_BYPASS = undefined;
    mocks.environment.dev = true;
  });

  it('is enabled only when dev and the flag is set', () => {
    mocks.env.DEV_AUTH_BYPASS = '1';
    expect(isDevAuthBypassEnabled()).toBe(true);
  });

  it('is disabled without the flag', () => {
    expect(isDevAuthBypassEnabled()).toBe(false);
  });

  it('is disabled outside a dev runtime even with the flag', () => {
    mocks.env.DEV_AUTH_BYPASS = '1';
    mocks.environment.dev = false;
    expect(isDevAuthBypassEnabled()).toBe(false);
  });
});

describe('bypassUsername', () => {
  beforeEach(() => {
    mocks.env.DEV_AUTH_BYPASS_USER = undefined;
  });

  it('defaults to "dev" when unset', () => {
    expect(bypassUsername()).toBe('dev');
  });

  it('lowercases and uses a configured username', () => {
    mocks.env.DEV_AUTH_BYPASS_USER = 'Alice';
    expect(bypassUsername()).toBe('alice');
  });

  it('falls back to the default for a reserved username', () => {
    mocks.env.DEV_AUTH_BYPASS_USER = 'admin';
    expect(bypassUsername()).toBe('dev');
  });

  it('falls back to the default for a malformed username', () => {
    mocks.env.DEV_AUTH_BYPASS_USER = '-bad-';
    expect(bypassUsername()).toBe('dev');
  });
});

describe('devAuthBypassHandle', () => {
  const resolve = vi.fn(async (event: { locals: Record<string, unknown> }) => event);

  beforeEach(() => {
    mocks.env.DEV_AUTH_BYPASS = '1';
    mocks.env.DEV_AUTH_BYPASS_USER = undefined;
    mocks.env.E2E_TEST_MODE = undefined;
    mocks.environment.dev = true;
    mocks.selectedRow = null;
    resolve.mockClear();
  });

  it('logs in the bypass user when the resolved row is a genuine bypass user', async () => {
    mocks.selectedRow = { username: 'dev', neonAuthUserId: 'dev-bypass:dev' };
    const event = { locals: {} };

    await devAuthBypassHandle({ event, resolve } as never);

    expect(event.locals).toMatchObject({ user: { username: 'dev' } });
  });

  it('refuses to log in as an existing account that merely shares the bypass username', async () => {
    // A real Neon Auth user happens to hold the "dev" handle.
    mocks.selectedRow = { username: 'dev', neonAuthUserId: 'neon-real-user-id' };
    const event = { locals: {} };

    await expect(devAuthBypassHandle({ event, resolve } as never)).rejects.toThrow(
      /already belongs to a real account/,
    );
  });

  it('is a pass-through when the bypass is not armed', async () => {
    mocks.env.DEV_AUTH_BYPASS = undefined;
    const event = { locals: {} };

    await devAuthBypassHandle({ event, resolve } as never);

    expect(event.locals).toEqual({});
  });
});
