import { describe, expect, it, vi } from 'vitest';
import { POST } from './+server';

const stopAgentMock = vi.hoisted(() => vi.fn());

vi.mock('$lib/server/review/operator', () => ({
  stopAgent: stopAgentMock,
}));

describe('POST /api/review/runs/[runId]/agents/[agentId]/stop', () => {
  it('redirects unauthenticated requests without stopping the agent', async () => {
    await expect(
      POST({
        locals: {},
        params: { runId: 'run_1', agentId: 'agent_security' },
        request: new Request(
          'https://tribunal.test/api/review/runs/run_1/agents/agent_security/stop',
        ),
      } as never),
    ).rejects.toMatchObject({ status: 302, location: '/login' });

    expect(stopAgentMock).not.toHaveBeenCalled();
  });

  it('stops the agent and returns JSON for authenticated API requests', async () => {
    stopAgentMock.mockResolvedValue({ ok: true });

    const response = await POST({
      locals: { user: { id: 42 } },
      params: { runId: 'run_1', agentId: 'agent_security' },
      request: new Request(
        'https://tribunal.test/api/review/runs/run_1/agents/agent_security/stop',
        {
          headers: { accept: 'application/json' },
        },
      ),
    } as never);

    expect(stopAgentMock).toHaveBeenCalledWith(42, 'run_1', 'agent_security');
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it('redirects authenticated HTML requests after stopping the agent', async () => {
    stopAgentMock.mockResolvedValue({ ok: true });

    await expect(
      POST({
        locals: { user: { id: 42 } },
        params: { runId: 'run_1', agentId: 'agent_security' },
        request: new Request(
          'https://tribunal.test/api/review/runs/run_1/agents/agent_security/stop',
          {
            headers: { accept: 'text/html' },
          },
        ),
      } as never),
    ).rejects.toMatchObject({ status: 303, location: '/runs/run_1' });

    expect(stopAgentMock).toHaveBeenCalledWith(42, 'run_1', 'agent_security');
  });
});
