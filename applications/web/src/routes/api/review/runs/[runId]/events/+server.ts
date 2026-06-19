import { redirect } from '@sveltejs/kit';
import { streamRunAgentEvents } from '$lib/server/review/operator';
import type { RequestHandler } from './$types';

function parseEventId(value: string | null): number | undefined {
  if (value === null) return undefined;
  const eventId = Number(value);
  return Number.isSafeInteger(eventId) && eventId >= 0 ? eventId : undefined;
}

export const GET: RequestHandler = async ({ locals, params, request }) => {
  const { user } = locals;
  if (!user) throw redirect(302, '/login');

  const url = new URL(request.url);
  const afterEventId =
    parseEventId(request.headers.get('last-event-id')) ??
    parseEventId(url.searchParams.get('after'));

  return streamRunAgentEvents(user.id, params.runId, request.signal, afterEventId);
};
