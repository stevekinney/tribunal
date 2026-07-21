import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockListAgents, mockSetAgentEnabled } = vi.hoisted(() => ({
  mockListAgents: vi.fn(),
  mockSetAgentEnabled: vi.fn(),
}));

vi.mock('@sveltejs/kit', () => ({
  redirect: (status: number, location: string) => {
    throw { status, location, type: 'redirect' };
  },
}));

vi.mock('$lib/server/review/operator', () => ({
  listAgents: mockListAgents,
  setAgentEnabled: mockSetAgentEnabled,
}));

import { load, actions } from './+page.server';

describe('/agents load', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('redirects to /login when no user is present', async () => {
    await expect(load({ locals: {} } as never)).rejects.toMatchObject({
      status: 302,
      location: '/login',
    });
    expect(mockListAgents).not.toHaveBeenCalled();
  });

  it('returns the agent list for the authenticated user', async () => {
    mockListAgents.mockResolvedValue([{ id: 'agent_1' }]);

    const data = await load({ locals: { user: { id: 1 } } } as never);

    expect(mockListAgents).toHaveBeenCalledWith(1);
    expect(data).toEqual({ agents: [{ id: 'agent_1' }] });
  });
});

describe('/agents actions.setEnabled', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('redirects to /login when no user is present', async () => {
    const request = { formData: vi.fn() } as unknown as Request;
    await expect(actions.setEnabled({ locals: {}, request } as never)).rejects.toMatchObject({
      status: 302,
      location: '/login',
    });
  });

  it('delegates to setAgentEnabled with the submitted form data', async () => {
    const formData = new FormData();
    formData.set('id', 'agent_1');
    const request = { formData: vi.fn().mockResolvedValue(formData) } as unknown as Request;
    mockSetAgentEnabled.mockResolvedValue({ success: true });

    const result = await actions.setEnabled({
      locals: { user: { id: 1 } },
      request,
    } as never);

    expect(mockSetAgentEnabled).toHaveBeenCalledWith(1, formData);
    expect(result).toEqual({ success: true });
  });
});
