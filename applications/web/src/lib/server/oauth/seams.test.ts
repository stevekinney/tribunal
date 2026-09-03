import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createOAuthStores } from '@tribunal/database/queries';
import { createTestDatabase, type TestDatabase } from '@tribunal/test/database';
import { mcpLogger } from '$lib/server/mcp-logger';
import { createTribunalOAuthSeams } from './seams';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
});

afterAll(async () => {
  await database.close();
});

describe('createTribunalOAuthSeams', () => {
  it('assembles the full host seams from the shared stores', () => {
    const seams = createTribunalOAuthSeams(createOAuthStores(database.db));
    expect(seams.hashCredential('value')).toHaveLength(64);
    expect(seams.scopes.supportedScopes).toContain('repositories:read');
    expect(typeof seams.resolveIdentityBinding).toBe('function');
    expect(typeof seams.fetchClientIdMetadataDocument).toBe('function');
  });

  it('records OAuth events through the shared logger', () => {
    const seams = createTribunalOAuthSeams(createOAuthStores(database.db));
    const info = vi.spyOn(mcpLogger, 'info').mockImplementation(() => mcpLogger);
    seams.recordEvent?.({ category: 'authorization', outcome: 'granted' });
    expect(info).toHaveBeenCalled();
    info.mockRestore();
  });
});
