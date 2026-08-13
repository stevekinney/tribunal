import { env } from '$env/dynamic/private';
import type {
  WorkflowCancellationReason,
  WorkflowCancellationResult,
} from '@tribunal/github/context';
import type { EnqueueInstallationSyncOptions } from '@tribunal/github/sync/types';

export const ENGINE_CONTROL_REQUEST_TIMEOUT_MS = 8_000;
export const ENGINE_WORKFLOW_CANCELLATION_REQUEST_MINIMUM_TIMEOUT_MS = 60_000;
export const ENGINE_WORKFLOW_CANCELLATION_REQUEST_PER_WORKFLOW_MS = 10_000;
export const ENGINE_WORKFLOW_CANCELLATION_REQUEST_MAXIMUM_TIMEOUT_MS = 300_000;

export type ReviewEngineSignalResult =
  | { status: 'not_configured'; missingSettings: string[] }
  | { status: 'sent'; ok: boolean; responseStatus: number; body?: unknown }
  | { status: 'failed'; error: unknown };

export async function postReviewEngineControl(
  path: string,
  body?: unknown,
  options: { timeoutMs?: number } = {},
): Promise<ReviewEngineSignalResult> {
  const missingSettings = [
    !env.TRIBUNAL_ENGINE_URL ? 'TRIBUNAL_ENGINE_URL' : null,
    !env.TRIBUNAL_ENGINE_CONTROL_TOKEN ? 'TRIBUNAL_ENGINE_CONTROL_TOKEN' : null,
  ].filter((setting): setting is string => setting !== null);

  if (missingSettings.length > 0) {
    return { status: 'not_configured', missingSettings };
  }

  try {
    const url = new URL(path, env.TRIBUNAL_ENGINE_URL);
    const abortController = new AbortController();
    const timeout = setTimeout(() => {
      abortController.abort(new Error('Engine control request timed out.'));
    }, options.timeoutMs ?? ENGINE_CONTROL_REQUEST_TIMEOUT_MS);
    const headers: Record<string, string> = {
      authorization: `Bearer ${env.TRIBUNAL_ENGINE_CONTROL_TOKEN}`,
    };
    if (body !== undefined) headers['content-type'] = 'application/json';
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        signal: abortController.signal,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return {
        status: 'sent',
        ok: response.ok,
        responseStatus: response.status,
        body: await readControlResponseBody(response),
      };
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    return { status: 'failed', error };
  }
}

async function readControlResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.trim() === '') return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function kickReviewEngine(): Promise<ReviewEngineSignalResult> {
  return postReviewEngineControl('/review-intents/kick');
}

export function signalInstallationSyncEngine(
  options: EnqueueInstallationSyncOptions,
): Promise<ReviewEngineSignalResult> {
  return postReviewEngineControl('/installation-syncs', options);
}

export function cancelInstallationSyncEngine(
  installationId: number,
): Promise<ReviewEngineSignalResult> {
  return postReviewEngineControl(`/installation-syncs/${installationId}/cancel`);
}

export function cancelReviewWorkflowsEngine(
  workflowIds: string[],
  cancellationReason?: WorkflowCancellationReason,
  userId?: number,
): Promise<ReviewEngineSignalResult> {
  return postReviewEngineControl(
    '/workflows/cancel',
    {
      workflowIds,
      ...(cancellationReason === undefined ? {} : { cancellationReason }),
      ...(userId === undefined ? {} : { userId }),
    },
    { timeoutMs: workflowCancellationRequestTimeoutMs(workflowIds) },
  );
}

export function createFailedWorkflowCancellationResult(
  workflowIds: string[],
  error: unknown,
): WorkflowCancellationResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    cancelled: 0,
    failed: workflowIds.length,
    errors: workflowIds.map((workflowId) => `${workflowId}: ${message}`),
  };
}

export function parseWorkflowCancellationResult(body: unknown): WorkflowCancellationResult | null {
  if (body === null || typeof body !== 'object') return null;
  const candidate = body as {
    cancelled?: unknown;
    failed?: unknown;
    errors?: unknown;
  };
  const { cancelled, failed, errors } = candidate;
  if (
    typeof cancelled !== 'number' ||
    !Number.isInteger(cancelled) ||
    typeof failed !== 'number' ||
    !Number.isInteger(failed) ||
    !Array.isArray(errors) ||
    !errors.every((error): error is string => typeof error === 'string')
  ) {
    return null;
  }
  return {
    cancelled,
    failed,
    errors,
  };
}

export function workflowCancellationRequestTimeoutMs(workflowIds: string[]): number {
  return Math.min(
    ENGINE_WORKFLOW_CANCELLATION_REQUEST_MAXIMUM_TIMEOUT_MS,
    Math.max(
      ENGINE_WORKFLOW_CANCELLATION_REQUEST_MINIMUM_TIMEOUT_MS,
      workflowIds.length * ENGINE_WORKFLOW_CANCELLATION_REQUEST_PER_WORKFLOW_MS,
    ),
  );
}
