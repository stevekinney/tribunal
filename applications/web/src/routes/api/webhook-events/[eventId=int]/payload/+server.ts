import { json } from '@sveltejs/kit';
import { getRepositoriesForUser } from '$lib/server/repositories';
import { getWebhookEventPayload } from '$lib/server/webhook-events';
import type { RequestHandler } from './$types';

const authenticationRequired = { message: 'Authentication required.' };
const notFound = { message: 'Webhook event not found.' };

export const GET: RequestHandler = async ({ locals, params }) => {
  const { user } = locals;
  if (!user) return json(authenticationRequired, { status: 401 });

  const eventId = Number(params.eventId);
  if (!Number.isSafeInteger(eventId) || eventId <= 0) return json(notFound, { status: 404 });

  const repositoriesResult = await getRepositoriesForUser(user.id);
  if (!repositoriesResult.ok) {
    if (repositoriesResult.error === 'no_github_token') {
      return json(authenticationRequired, { status: 401 });
    }
    return json({ message: 'Unable to verify repository access.' }, { status: 503 });
  }

  const payload = await getWebhookEventPayload(
    repositoriesResult.repositories.map((entry) => entry.repository.id),
    eventId,
  );
  if (!payload) return json(notFound, { status: 404 });

  return json(payload, { headers: { 'cache-control': 'no-store' } });
};
