import { isWeftFault } from '@lostgradient/weft';
import {
  isWorkflowCancellationReason,
  type WorkflowCancellationReason,
} from '@tribunal/github/context';
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

  return Response.json({ ok: true, workflowId: result.workflowId }, { status: 202 });
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

export async function handleInstallationSyncCancellationRequest(
  installationId: number,
  runtime: Pick<EngineRuntime, 'cancelInstallationSync'>,
): Promise<Response> {
  if (runtime.cancelInstallationSync === undefined) {
    return Response.json(
      { ok: false, error: 'installation_sync_receiver_unavailable' },
      { status: 503 },
    );
  }

  if (!Number.isInteger(installationId) || installationId <= 0) {
    return Response.json(
      { ok: false, error: 'invalid_installation_sync_cancellation' },
      { status: 400 },
    );
  }

  try {
    await runtime.cancelInstallationSync(installationId);
  } catch (error) {
    if (!isWeftFault(error, 'WorkflowNotFoundError')) throw error;
  }
  return Response.json({ ok: true, cancelled: true }, { status: 202 });
}

export async function handleWorkflowCancellationRequest(
  request: Request,
  runtime: Pick<EngineRuntime, 'cancelWorkflowIds'>,
): Promise<Response> {
  if (runtime.cancelWorkflowIds === undefined) {
    return Response.json(
      { ok: false, error: 'workflow_cancellation_receiver_unavailable' },
      { status: 503 },
    );
  }

  const input = await readWorkflowCancellationInput(request);
  if (!input.ok) {
    return Response.json({ ok: false, error: input.error }, { status: 400 });
  }

  const result = await runtime.cancelWorkflowIds(
    input.workflowIds,
    input.cancellationReason,
    input.userId,
  );
  return Response.json(
    { ok: result.failed === 0, ...result },
    { status: result.failed === 0 ? 202 : 502 },
  );
}

async function readWorkflowCancellationInput(request: Request): Promise<
  | {
      ok: true;
      workflowIds: string[];
      cancellationReason?: WorkflowCancellationReason;
      userId?: number;
    }
  | { ok: false; error: 'invalid_workflow_cancellation_request' }
> {
  try {
    const body = await request.json();
    if (!isWorkflowCancellationInput(body)) {
      return { ok: false, error: 'invalid_workflow_cancellation_request' };
    }
    return {
      ok: true,
      workflowIds: body.workflowIds,
      cancellationReason: body.cancellationReason,
      userId: body.userId,
    };
  } catch {
    return { ok: false, error: 'invalid_workflow_cancellation_request' };
  }
}

function isWorkflowCancellationInput(value: unknown): value is {
  workflowIds: string[];
  cancellationReason?: WorkflowCancellationReason;
  userId?: number;
} {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as {
    workflowIds?: unknown;
    cancellationReason?: unknown;
    userId?: unknown;
  };
  const isPolicyCancellation =
    candidate.cancellationReason === 'reviews_paused' ||
    candidate.cancellationReason === 'repository_unwatched';
  return (
    Array.isArray(candidate.workflowIds) &&
    candidate.workflowIds.length > 0 &&
    candidate.workflowIds.every(
      (workflowId) => typeof workflowId === 'string' && workflowId.length > 0,
    ) &&
    (candidate.cancellationReason === undefined ||
      isWorkflowCancellationReason(candidate.cancellationReason)) &&
    (candidate.userId === undefined ||
      (typeof candidate.userId === 'number' &&
        Number.isInteger(candidate.userId) &&
        candidate.userId > 0)) &&
    (!isPolicyCancellation || candidate.userId !== undefined)
  );
}
