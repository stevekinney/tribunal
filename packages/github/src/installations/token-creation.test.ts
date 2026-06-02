import { describe, it, expect, vi } from 'vitest';
import type { App } from 'octokit';
import { createInstallationToken } from './tokens.js';

function createMockApp(mockFn: ReturnType<typeof vi.fn>): App {
  return {
    octokit: {
      rest: {
        apps: {
          createInstallationAccessToken: mockFn,
        },
      },
    },
  } as unknown as App;
}

describe('createInstallationToken', () => {
  it('returns ok: true with token on success', async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      data: {
        token: 'ghs_test123',
        expires_at: '2025-01-01T01:00:00Z',
      },
    });
    const app = createMockApp(mockCreate);

    const result = await createInstallationToken(app, { installationId: 42 });

    expect(result).toEqual({
      ok: true,
      token: {
        token: 'ghs_test123',
        expiresAt: '2025-01-01T01:00:00Z',
        installationId: 42,
      },
    });
  });

  it('passes repository_ids when repositoryIds provided', async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      data: { token: 'ghs_test', expires_at: '2025-01-01T01:00:00Z' },
    });
    const app = createMockApp(mockCreate);

    await createInstallationToken(app, {
      installationId: 42,
      repositoryIds: [100, 200],
    });

    expect(mockCreate).toHaveBeenCalledWith({
      installation_id: 42,
      repository_ids: [100, 200],
    });
  });

  it('passes permissions when provided', async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      data: { token: 'ghs_test', expires_at: '2025-01-01T01:00:00Z' },
    });
    const app = createMockApp(mockCreate);

    await createInstallationToken(app, {
      installationId: 42,
      permissions: { contents: 'read', metadata: 'read' },
    });

    expect(mockCreate).toHaveBeenCalledWith({
      installation_id: 42,
      permissions: { contents: 'read', metadata: 'read' },
    });
  });

  it('passes both repositoryIds and permissions when provided', async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      data: { token: 'ghs_test', expires_at: '2025-01-01T01:00:00Z' },
    });
    const app = createMockApp(mockCreate);

    await createInstallationToken(app, {
      installationId: 42,
      repositoryIds: [100, 200],
      permissions: { contents: 'write' },
    });

    expect(mockCreate).toHaveBeenCalledWith({
      installation_id: 42,
      repository_ids: [100, 200],
      permissions: { contents: 'write' },
    });
  });

  it('omits optional params when not provided', async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      data: { token: 'ghs_test', expires_at: '2025-01-01T01:00:00Z' },
    });
    const app = createMockApp(mockCreate);

    await createInstallationToken(app, { installationId: 42 });

    expect(mockCreate).toHaveBeenCalledWith({
      installation_id: 42,
    });
  });

  it('omits repository_ids when array is empty', async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      data: { token: 'ghs_test', expires_at: '2025-01-01T01:00:00Z' },
    });
    const app = createMockApp(mockCreate);

    await createInstallationToken(app, {
      installationId: 42,
      repositoryIds: [],
    });

    expect(mockCreate).toHaveBeenCalledWith({
      installation_id: 42,
    });
  });

  it('returns ok: false with classified error on API failure', async () => {
    expect.assertions(3);

    const error = Object.assign(new Error('Not Found'), {
      status: 404,
      response: { data: { message: 'Not Found' }, headers: {} },
    });
    const mockCreate = vi.fn().mockRejectedValue(error);
    const app = createMockApp(mockCreate);

    const result = await createInstallationToken(app, { installationId: 42 });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('not_found');
      expect(result.error.installationId).toBe(42);
    }
  });

  it('returns ok: false for rate limit errors', async () => {
    expect.assertions(2);

    const error = Object.assign(new Error('rate limit exceeded'), {
      status: 429,
      response: {
        data: { message: 'rate limit exceeded' },
        headers: { 'retry-after': '60' },
      },
    });
    const mockCreate = vi.fn().mockRejectedValue(error);
    const app = createMockApp(mockCreate);

    const result = await createInstallationToken(app, { installationId: 42 });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('rate_limited');
    }
  });

  it('classifies 5xx errors as server_error (retryable)', async () => {
    expect.assertions(2);

    const error = Object.assign(new Error('Internal Server Error'), {
      status: 502,
      response: { data: { message: 'Internal Server Error' }, headers: {} },
    });
    const mockCreate = vi.fn().mockRejectedValue(error);
    const app = createMockApp(mockCreate);

    const result = await createInstallationToken(app, { installationId: 42 });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('server_error');
    }
  });

  it('classifies network errors as server_error (retryable)', async () => {
    expect.assertions(2);

    const error = new Error('fetch failed');
    const mockCreate = vi.fn().mockRejectedValue(error);
    const app = createMockApp(mockCreate);

    const result = await createInstallationToken(app, { installationId: 42 });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('server_error');
    }
  });

  it('does not expose token string in error results', async () => {
    expect.assertions(3);

    const error = Object.assign(new Error('Forbidden'), {
      status: 403,
      response: { data: { message: 'Forbidden' }, headers: {} },
    });
    const mockCreate = vi.fn().mockRejectedValue(error);
    const app = createMockApp(mockCreate);

    const result = await createInstallationToken(app, { installationId: 42 });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(JSON.stringify(result)).not.toContain('ghs_');
      expect('token' in result).toBe(false);
    }
  });
});
