import { describe, expect, it, vi } from 'vitest';
import { POST } from './+server';

const stopRunMock = vi.hoisted(() => vi.fn());

vi.mock('$lib/server/review/operator', () => ({
  stopRun: stopRunMock,
}));

describe('POST /api/review/runs/[runId]/stop', () => {
  it('redirects unauthenticated requests without stopping the run', async () => {
    await expect(
      POST({
        locals: {},
        params: { runId: 'run_1' },
        request: new Request('https://tribunal.test/api/review/runs/run_1/stop'),
      } as never),
    ).rejects.toMatchObject({ status: 302, location: '/login' });

    expect(stopRunMock).not.toHaveBeenCalled();
  });

  it('stops the run and returns JSON for authenticated API requests', async () => {
    stopRunMock.mockResolvedValue({ ok: true });

    const response = await POST({
      locals: { user: { id: 42 } },
      params: { runId: 'run_1' },
      request: new Request('https://tribunal.test/api/review/runs/run_1/stop', {
        headers: { accept: 'application/json' },
      }),
    } as never);

    expect(stopRunMock).toHaveBeenCalledWith(42, 'run_1');
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it('redirects authenticated HTML requests after stopping the run', async () => {
    stopRunMock.mockResolvedValue({ ok: true });

    await expect(
      POST({
        locals: { user: { id: 42 } },
        params: { runId: 'run_1' },
        request: new Request('https://tribunal.test/api/review/runs/run_1/stop', {
          headers: { accept: 'text/html' },
        }),
      } as never),
    ).rejects.toMatchObject({ status: 303, location: '/runs/run_1' });

    expect(stopRunMock).toHaveBeenCalledWith(42, 'run_1');
  });
});
