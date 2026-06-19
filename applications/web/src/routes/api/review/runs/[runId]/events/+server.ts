import { redirect } from '@sveltejs/kit';
import { streamRunAgentEvents } from '$lib/server/review/operator';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params, request }) => {
  const { user } = locals;
  if (!user) throw redirect(302, '/login');

  const url = new URL(request.url);
  const rawAfter = url.searchParams.get('after');
  const rawAfterEventId = rawAfter === null ? Number.NaN : Number(rawAfter);
  const afterEventId =
    Number.isSafeInteger(rawAfterEventId) && rawAfterEventId >= 0 ? rawAfterEventId : undefined;

  return streamRunAgentEvents(user.id, params.runId, request.signal, afterEventId);
};
