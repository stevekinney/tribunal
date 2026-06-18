import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createDatabase, execute } = vi.hoisted(() => ({
  createDatabase: vi.fn(() => ({ execute })),
  execute: vi.fn(async () => undefined),
}));

vi.mock('@tribunal/database', () => ({
  createDatabase,
}));

vi.mock('@tribunal/database/operators', () => ({
  sql: (strings: TemplateStringsArray) => strings.join(''),
}));

describe('probeDatabase', () => {
  beforeEach(() => {
    vi.resetModules();
    createDatabase.mockClear();
    execute.mockClear();
  });

  it('does not create a database when no URL is configured', async () => {
    const { probeDatabase } = await import('./health-database');

    await probeDatabase(undefined);

    expect(createDatabase).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it('reuses the health database for repeated probes with the same URL', async () => {
    const { probeDatabase } = await import('./health-database');
    const databaseUrl = 'postgres://tribunal:tribunal@host.docker.internal:5433/tribunal';

    await probeDatabase(databaseUrl);
    await probeDatabase(databaseUrl);

    expect(createDatabase).toHaveBeenCalledOnce();
    expect(createDatabase).toHaveBeenCalledWith(databaseUrl);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('creates a new health database when the configured URL changes', async () => {
    const { probeDatabase } = await import('./health-database');

    await probeDatabase('postgres://tribunal:tribunal@localhost:5432/tribunal');
    await probeDatabase('postgres://tribunal:tribunal@localhost:5433/tribunal');

    expect(createDatabase).toHaveBeenCalledTimes(2);
  });
});
