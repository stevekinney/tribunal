import { describe, expect, it, vi } from 'vitest';
import { GET } from './+server';

const streamRunAgentEventsMock = vi.hoisted(() => vi.fn());

vi.mock('$lib/server/review/operator', () => ({
  streamRunAgentEvents: streamRunAgentEventsMock,
}));

describe('GET /api/review/runs/[runId]/events', () => {
  it('redirects unauthenticated requests without opening the stream', async () => {
    await expect(
      GET({
        locals: {},
        params: { runId: 'run_1' },
        request: new Request('https://tribunal.test/api/review/runs/run_1/events'),
      } as never),
    ).rejects.toMatchObject({ status: 302, location: '/login' });

    expect(streamRunAgentEventsMock).not.toHaveBeenCalled();
  });

  it('opens the authenticated event stream for a run', async () => {
    const response = new Response('event: agent_event\n\n', {
      headers: { 'content-type': 'text/event-stream' },
    });
    streamRunAgentEventsMock.mockResolvedValue(response);
    const request = new Request('https://tribunal.test/api/review/runs/run_1/events');

    await expect(
      GET({
        locals: { user: { id: 42 } },
        params: { runId: 'run_1' },
        request,
      } as never),
    ).resolves.toBe(response);

    expect(streamRunAgentEventsMock).toHaveBeenCalledWith(42, 'run_1', request.signal);
  });
});
