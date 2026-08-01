import { env } from '$env/dynamic/private';
import type { EnqueueInstallationSyncOptions } from '@tribunal/github/sync/types';

export const ENGINE_CONTROL_REQUEST_TIMEOUT_MS = 8_000;

export type ReviewEngineSignalResult =
  | { status: 'not_configured'; missingSettings: string[] }
  | { status: 'sent'; ok: boolean; responseStatus: number }
  | { status: 'failed'; error: unknown };

export async function postReviewEngineControl(
  path: string,
  body?: unknown,
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
    }, ENGINE_CONTROL_REQUEST_TIMEOUT_MS);
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
      return { status: 'sent', ok: response.ok, responseStatus: response.status };
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    return { status: 'failed', error };
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
