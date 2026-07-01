import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  env: {
    DEV_AUTH_BYPASS: undefined as string | undefined,
    E2E_TEST_MODE: undefined as string | undefined,
  },
  environment: { dev: true, building: false },
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

// db/schema are imported by the module under test but never exercised here.
vi.mock('$lib/server/database', () => ({ db: {} }));

import { assertDevAuthBypassNotInProduction, isDevAuthBypassEnabled } from './dev-bypass';

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
