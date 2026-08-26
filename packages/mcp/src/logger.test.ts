import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `canResolvePrettyTransport` (private to `logger.ts`) resolves
 * `pino-pretty` via `createRequire(...).resolve(...)` and falls back to
 * plain JSON output on failure -- the whole point being that a missing
 * `pino-pretty` (a devDependency, absent from a production install) must
 * never crash `createLogger()`. `pino-pretty` genuinely IS resolvable in
 * this dev/test environment, so every other test that calls `createLogger`
 * only exercises the success branch; nothing exercises the failure branch
 * without actually making resolution fail.
 *
 * `vi.doMock('node:module', ...)` + `vi.resetModules()` re-imports
 * `logger.ts` fresh against a patched `createRequire` whose `.resolve`
 * throws for `pino-pretty` only, restoring the real implementation
 * afterward so no other test in this file (or this process) sees the
 * patched version.
 */
describe('createLogger (pino-pretty resolution failure fallback)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock('node:module');
    vi.resetModules();
  });

  it('still returns a working logger when pino-pretty cannot be resolved', async () => {
    vi.doMock('node:module', async () => {
      const real = await vi.importActual<typeof import('node:module')>('node:module');
      return {
        ...real,
        createRequire: (url: string) => {
          const realRequire = real.createRequire(url);
          const patched = ((id: string) => realRequire(id)) as NodeJS.Require;
          patched.resolve = ((id: string, options?: unknown) => {
            if (id === 'pino-pretty') {
              throw new Error('Cannot find module pino-pretty (mocked for this test)');
            }
            return (realRequire.resolve as (id: string, options?: unknown) => string)(id, options);
          }) as NodeJS.RequireResolve;
          return patched;
        },
      };
    });

    const { createLogger } = await import('./logger.js');
    expect(() => createLogger()).not.toThrow();
    const logger = createLogger();
    expect(typeof logger.info).toBe('function');
    expect(logger.level).toBeTruthy();
  });

  it('resolves pino-pretty normally and still returns a working logger (unmocked baseline)', async () => {
    const { createLogger } = await import('./logger.js');
    const logger = createLogger();
    expect(typeof logger.info).toBe('function');
  });
});
