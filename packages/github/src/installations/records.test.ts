import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDatabase, type TestDatabase } from '@tribunal/test/database';
import { createFactories, type AllFactories } from '@tribunal/test/factories';
import type { Database } from '@tribunal/database';
import type { GithubServiceContext } from '../context.js';
import {
  deleteInstallation,
  getInstallationBindingStatus,
  getInstallationById,
  updateInstallationAccountMetadata,
  updateInstallationStatus,
  upsertInstallation,
} from './records.js';

let testDatabase: TestDatabase;
let factories: AllFactories;
let context: GithubServiceContext;

beforeAll(async () => {
  testDatabase = await createTestDatabase();
  factories = createFactories(testDatabase.db);
});

afterAll(async () => {
  await testDatabase.close();
});

beforeEach(async () => {
  await testDatabase.reset();
  context = {
    db: testDatabase.db as Database,
    cache: {
      getCached: vi.fn().mockResolvedValue(null),
      setCache: vi.fn().mockResolvedValue(true),
      setCacheIndefinitely: vi.fn().mockResolvedValue(true),
      deleteCache: vi.fn().mockResolvedValue(true),
      deleteCacheByPattern: vi.fn().mockResolvedValue(0),
      resetCacheClient: vi.fn(),
    },
    getInstallationOctokit: vi.fn().mockResolvedValue(null),
    getGithubApplication: vi.fn().mockReturnValue(null),
  };
});

describe('upsertInstallation', () => {
  it('creates a new installation record with an unbound userId when omitted', async () => {
    await upsertInstallation(context, {
      installationId: 555,
      accountLogin: 'octo-org',
      accountId: 999,
    });

    const installation = await getInstallationById(context, 555);

    expect(installation).not.toBeNull();
    expect(installation?.accountLogin).toBe('octo-org');
    expect(installation?.status).toBe('active');
    expect(installation?.userId).toBeNull();
  });

  it('binds the installation to a user when userId is supplied', async () => {
    const owner = await factories.user.create();

    await upsertInstallation(context, {
      installationId: 557,
      accountLogin: 'octo-org',
      accountId: 1001,
      userId: owner.id,
    });

    const installation = await getInstallationById(context, 557);

    expect(installation?.userId).toBe(owner.id);
  });

  it('updates an existing installation on conflict without clearing the binding when userId is omitted', async () => {
    const owner = await factories.user.create();
    await factories.githubInstallation.create({
      installationId: 558,
      accountLogin: 'octo-org',
      userId: owner.id,
    });

    // Webhook stub upsert: no userId supplied.
    await upsertInstallation(context, {
      installationId: 558,
      accountLogin: 'octo-org-renamed',
      accountId: 1002,
      accountAvatarUrl: 'https://avatar/renamed',
    });

    const installation = await getInstallationById(context, 558);

    expect(installation?.accountLogin).toBe('octo-org-renamed');
    expect(installation?.userId).toBe(owner.id);
    expect(installation?.accountAvatarUrl).toBe('https://avatar/renamed');
  });

  it('preserves existing account metadata on conflict when requested', async () => {
    const owner = await factories.user.create();
    await upsertInstallation(context, {
      installationId: 561,
      accountLogin: 'new-org',
      accountId: 2006,
      accountAvatarUrl: 'https://avatar/new',
      userId: owner.id,
    });

    await upsertInstallation(context, {
      installationId: 561,
      accountLogin: 'old-org',
      accountId: 1006,
      accountAvatarUrl: 'https://avatar/old',
      preserveExistingAccountMetadata: true,
    });

    const installation = await getInstallationById(context, 561);

    expect(installation?.accountLogin).toBe('new-org');
    expect(installation?.accountId).toBe(2006);
    expect(installation?.accountAvatarUrl).toBe('https://avatar/new');
    expect(installation?.userId).toBe(owner.id);
  });

  it('overwrites the binding on conflict when a userId is supplied', async () => {
    const firstOwner = await factories.user.create();
    const secondOwner = await factories.user.create();
    await factories.githubInstallation.create({
      installationId: 559,
      accountLogin: 'octo-org',
      userId: firstOwner.id,
    });

    await upsertInstallation(context, {
      installationId: 559,
      accountLogin: 'octo-org',
      accountId: 1003,
      userId: secondOwner.id,
    });

    const installation = await getInstallationById(context, 559);

    expect(installation?.userId).toBe(secondOwner.id);
  });

  it('reactivates an installation on conflict', async () => {
    await factories.githubInstallation.create({
      installationId: 560,
      accountLogin: 'octo-org',
      status: 'suspended',
    });
    await updateInstallationStatus(context, 560, 'suspended');

    await upsertInstallation(context, {
      installationId: 560,
      accountLogin: 'octo-org',
      accountId: 1004,
    });

    const installation = await getInstallationById(context, 560);

    expect(installation?.status).toBe('active');
  });
});

describe('getInstallationById', () => {
  it('returns null when no installation matches', async () => {
    const installation = await getInstallationById(context, 99999);

    expect(installation).toBeNull();
  });
});

describe('updateInstallationAccountMetadata', () => {
  it('updates account metadata without changing the binding', async () => {
    const owner = await factories.user.create();
    await factories.githubInstallation.create({
      installationId: 566,
      accountLogin: 'old-org',
      accountId: 1005,
      accountAvatarUrl: 'https://avatar/old',
      userId: owner.id,
    });

    const result = await updateInstallationAccountMetadata(context, {
      installationId: 566,
      accountLogin: 'new-org',
      accountId: 2005,
      accountAvatarUrl: 'https://avatar/new',
    });

    const installation = await getInstallationById(context, 566);

    expect(result).toEqual({ updated: true });
    expect(installation?.accountLogin).toBe('new-org');
    expect(installation?.accountId).toBe(2005);
    expect(installation?.accountAvatarUrl).toBe('https://avatar/new');
    expect(installation?.userId).toBe(owner.id);
  });

  it('reports when no installation row was updated', async () => {
    const result = await updateInstallationAccountMetadata(context, {
      installationId: 999999,
      accountLogin: 'missing-org',
      accountId: 3005,
      accountAvatarUrl: null,
    });

    expect(result).toEqual({ updated: false });
  });
});

describe('getInstallationBindingStatus', () => {
  it('returns unbound when no installation record exists', async () => {
    const status = await getInstallationBindingStatus(context, 88888);

    expect(status).toEqual({ status: 'unbound', installationExists: false });
  });

  it('returns orphan when the installation exists but has no userId', async () => {
    const installation = await factories.githubInstallation.create({ installationId: 561 });

    const status = await getInstallationBindingStatus(context, 561);

    expect(status.status).toBe('orphan');
    expect(status.installationExists).toBe(true);
    if (status.status === 'orphan') {
      expect(status.installation.installationId).toBe(installation.installationId);
    }
  });

  it('returns bound when the installation is linked to a user', async () => {
    const owner = await factories.user.create();
    await factories.githubInstallation.createForUser(owner.id, { installationId: 562 });

    const status = await getInstallationBindingStatus(context, 562);

    expect(status.status).toBe('bound');
    if (status.status === 'bound') {
      expect(status.userId).toBe(owner.id);
    }
  });
});

describe('deleteInstallation', () => {
  it('removes the installation record', async () => {
    await factories.githubInstallation.create({ installationId: 563 });

    await deleteInstallation(context, 563);

    const installation = await getInstallationById(context, 563);
    expect(installation).toBeNull();
  });

  it('is a no-op when the installation does not exist', async () => {
    await expect(deleteInstallation(context, 777777)).resolves.toBeUndefined();
  });
});

describe('updateInstallationStatus', () => {
  it('updates status', async () => {
    await factories.githubInstallation.create({ installationId: 564 });

    await updateInstallationStatus(context, 564, 'suspended');

    const installation = await getInstallationById(context, 564);
    expect(installation?.status).toBe('suspended');
  });
});
