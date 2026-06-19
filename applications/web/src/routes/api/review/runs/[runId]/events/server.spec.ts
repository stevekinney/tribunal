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
    const request = new Request('https://tribunal.test/api/review/runs/run_1/events?after=37');

    await expect(
      GET({
        locals: { user: { id: 42 } },
        params: { runId: 'run_1' },
        request,
      } as never),
    ).resolves.toBe(response);

    expect(streamRunAgentEventsMock).toHaveBeenCalledWith(42, 'run_1', request.signal, 37);
  });

  it('prefers the Last-Event-ID header over the initial query cursor', async () => {
    const response = new Response('event: agent_event\n\n', {
      headers: { 'content-type': 'text/event-stream' },
    });
    streamRunAgentEventsMock.mockResolvedValue(response);
    const request = new Request('https://tribunal.test/api/review/runs/run_1/events?after=37', {
      headers: { 'Last-Event-ID': '42' },
    });

    await expect(
      GET({
        locals: { user: { id: 42 } },
        params: { runId: 'run_1' },
        request,
      } as never),
    ).resolves.toBe(response);

    expect(streamRunAgentEventsMock).toHaveBeenCalledWith(42, 'run_1', request.signal, 42);
  });

  it('uses the Last-Event-ID header when the query cursor is absent', async () => {
    const response = new Response('event: agent_event\n\n', {
      headers: { 'content-type': 'text/event-stream' },
    });
    streamRunAgentEventsMock.mockResolvedValue(response);
    const request = new Request('https://tribunal.test/api/review/runs/run_1/events', {
      headers: { 'Last-Event-ID': '39' },
    });

    await expect(
      GET({
        locals: { user: { id: 42 } },
        params: { runId: 'run_1' },
        request,
      } as never),
    ).resolves.toBe(response);

    expect(streamRunAgentEventsMock).toHaveBeenCalledWith(42, 'run_1', request.signal, 39);
  });

  it('omits the after event id when the query parameter is absent', async () => {
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

    expect(streamRunAgentEventsMock).toHaveBeenCalledWith(42, 'run_1', request.signal, undefined);
  });
});
