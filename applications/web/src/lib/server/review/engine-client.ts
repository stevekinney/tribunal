import { env } from '$env/dynamic/private';

export type ReviewEngineSignalResult =
  | { status: 'not_configured'; missingSettings: string[] }
  | { status: 'sent'; ok: boolean; responseStatus: number }
  | { status: 'failed'; error: unknown };

export async function postReviewEngineControl(path: string): Promise<ReviewEngineSignalResult> {
  const missingSettings = [
    !env.TRIBUNAL_ENGINE_URL ? 'TRIBUNAL_ENGINE_URL' : null,
    !env.TRIBUNAL_ENGINE_CONTROL_TOKEN ? 'TRIBUNAL_ENGINE_CONTROL_TOKEN' : null,
  ].filter((setting): setting is string => setting !== null);

  if (missingSettings.length > 0) {
    return { status: 'not_configured', missingSettings };
  }

  try {
    const url = new URL(path, env.TRIBUNAL_ENGINE_URL);
    const response = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${env.TRIBUNAL_ENGINE_CONTROL_TOKEN}` },
    });
    return { status: 'sent', ok: response.ok, responseStatus: response.status };
  } catch (error) {
    return { status: 'failed', error };
  }
}

export function kickReviewEngine(): Promise<ReviewEngineSignalResult> {
  return postReviewEngineControl('/review-intents/kick');
}
