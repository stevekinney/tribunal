import { redirect } from '@sveltejs/kit';
import { streamRunAgentEvents } from '$lib/server/review/operator';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params, request }) => {
  const { user } = locals;
  if (!user) throw redirect(302, '/login');

  return streamRunAgentEvents(user.id, params.runId, request.signal);
};
