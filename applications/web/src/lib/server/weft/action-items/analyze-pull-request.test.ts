/**
 * Regression test for analyzePullRequest's activity calling convention.
 *
 * Weft invokes an activity as execute(input, ActivityContext) — the AbortSignal
 * is ActivityContext.signal, NOT the second positional argument itself. An
 * earlier version typed the second param as `signal?: AbortSignal`, so at runtime
 * the engine's ActivityContext was bound to `signal` and `signal.throwIfAborted`
 * was undefined — the cooperative cancellation checks silently never fired (or
 * threw a TypeError). This test pins that the activity reads the signal from the
 * context and honors a pre-aborted signal before doing any I/O.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

const { getInstallationOctokit } = vi.hoisted(() => ({
  getInstallationOctokit: vi.fn(),
}));

// The activity destructures githubContext at the top, so the mock must provide
// db + getInstallationOctokit. getInstallationOctokit must NOT be called when the
// signal is already aborted (the abort check fires first).
vi.mock('$lib/server/github-context', () => ({
  githubContext: {
    db: {},
    getInstallationOctokit,
  },
}));

import { analyzePullRequest } from './analyze-pull-request.js';

afterEach(() => {
  getInstallationOctokit.mockReset();
});

const input = {
  workspaceId: 1,
  repositoryId: 10,
  prNumber: 5,
  installationId: 100,
  owner: 'acme',
  repository: 'widgets',
  analysisGeneration: 1,
};

describe('analyzePullRequest cooperative cancellation', () => {
  it('reads the AbortSignal from ActivityContext.signal and honors a pre-aborted run', async () => {
    const controller = new AbortController();
    controller.abort();

    // Pass the signal the way Weft does: as ActivityContext.signal.
    await expect(analyzePullRequest(input, { signal: controller.signal })).rejects.toThrow();

    // The abort check fired before any GitHub I/O.
    expect(getInstallationOctokit).not.toHaveBeenCalled();
  });

  it('does not abort when the context signal is not aborted (reaches the octokit lookup)', async () => {
    // Not aborted: the activity proceeds past the first throwIfAborted to the
    // octokit lookup. We stub getInstallationOctokit to return null so the
    // activity returns early (Installation not configured) without real I/O —
    // proving the signal was read from the context and did NOT spuriously abort.
    getInstallationOctokit.mockResolvedValue(null);
    const controller = new AbortController();

    const result = await analyzePullRequest(input, { signal: controller.signal });

    expect(getInstallationOctokit).toHaveBeenCalledWith(100);
    expect(result).toEqual({
      updated: false,
      actionItemCount: 0,
      persisted: false,
      error: 'Installation not configured',
    });
  });
});
