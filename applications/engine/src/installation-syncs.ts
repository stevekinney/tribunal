import type { EnqueueInstallationSyncOptions } from '@tribunal/github/sync/types';
import type { EngineRuntime } from './workflows/bootstrap';

export async function handleInstallationSyncRequest(
  request: Request,
  runtime: Pick<EngineRuntime, 'enqueueInstallationSync'>,
): Promise<Response> {
  if (runtime.enqueueInstallationSync === undefined) {
    return Response.json(
      { ok: false, error: 'installation_sync_receiver_unavailable' },
      { status: 503 },
    );
  }

  const input = await readInstallationSyncInput(request);
  if (!input.ok) {
    return Response.json({ ok: false, error: input.error }, { status: 400 });
  }

  const result = await runtime.enqueueInstallationSync(input.options);
  if (result.status === 'error') {
    return Response.json(
      { ok: false, error: result.error, workflowId: result.workflowId },
      { status: 502 },
    );
  }

  return Response.json(
    { ok: true, workflowId: result.workflowId, outcome: result.outcome },
    { status: 202 },
  );
}

async function readInstallationSyncInput(
  request: Request,
): Promise<
  | { ok: true; options: EnqueueInstallationSyncOptions }
  | { ok: false; error: 'invalid_installation_sync_request' }
> {
  try {
    const body = await request.json();
    if (!isInstallationSyncInput(body)) {
      return { ok: false, error: 'invalid_installation_sync_request' };
    }
    return { ok: true, options: body };
  } catch {
    return { ok: false, error: 'invalid_installation_sync_request' };
  }
}

function isInstallationSyncInput(value: unknown): value is EnqueueInstallationSyncOptions {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as Partial<EnqueueInstallationSyncOptions>;
  return (
    typeof candidate.installationId === 'number' &&
    Number.isInteger(candidate.installationId) &&
    candidate.installationId > 0 &&
    typeof candidate.reason === 'string' &&
    candidate.reason.length > 0 &&
    (candidate.workspaceId === undefined ||
      (typeof candidate.workspaceId === 'number' &&
        Number.isInteger(candidate.workspaceId) &&
        candidate.workspaceId > 0)) &&
    (candidate.triggeredByUserId === undefined ||
      (typeof candidate.triggeredByUserId === 'number' &&
        Number.isInteger(candidate.triggeredByUserId) &&
        candidate.triggeredByUserId > 0)) &&
    (candidate.deliveryId === undefined || typeof candidate.deliveryId === 'string')
  );
}
