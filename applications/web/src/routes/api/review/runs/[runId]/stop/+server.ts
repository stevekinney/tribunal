import { json, redirect } from '@sveltejs/kit';
import { stopRun } from '$lib/server/review/operator';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, params, request }) => {
  const { user } = locals;
  if (!user) redirect(302, '/login');

  await stopRun(user.id, params.runId);

  const acceptsHtml = request.headers.get('accept')?.includes('text/html') ?? false;
  if (acceptsHtml) redirect(303, `/runs/${params.runId}`);
  return json({ ok: true });
};
