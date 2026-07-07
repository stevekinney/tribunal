import { describe, expect, it } from 'vitest';
import {
  isOwnGithubAppCheckEvent,
  isRerunTriggerWebhookEvent,
  RE_REVIEW_ACTION_IDENTIFIER,
} from './re-run-triggers.js';
import type { WebhookPayload } from './types.js';

const OWN_APP_ID = '12345';

describe('isOwnGithubAppCheckEvent', () => {
  it('matches when check_run.app.id equals the configured app id', () => {
    const data = { check_run: { app: { id: 12345 } } } as unknown as WebhookPayload;
    expect(isOwnGithubAppCheckEvent(data, 'check_run', OWN_APP_ID)).toBe(true);
  });

  it('matches when check_suite.app.id equals the configured app id', () => {
    const data = { check_suite: { app: { id: 12345 } } } as unknown as WebhookPayload;
    expect(isOwnGithubAppCheckEvent(data, 'check_suite', OWN_APP_ID)).toBe(true);
  });

  it('does not match a different app id', () => {
    const data = { check_run: { app: { id: 99999 } } } as unknown as WebhookPayload;
    expect(isOwnGithubAppCheckEvent(data, 'check_run', OWN_APP_ID)).toBe(false);
  });

  it('does not match when the own app id is not configured', () => {
    const data = { check_run: { app: { id: 12345 } } } as unknown as WebhookPayload;
    expect(isOwnGithubAppCheckEvent(data, 'check_run', undefined)).toBe(false);
  });

  it('does not match unrelated event types', () => {
    const data = { check_run: { app: { id: 12345 } } } as unknown as WebhookPayload;
    expect(isOwnGithubAppCheckEvent(data, 'pull_request', OWN_APP_ID)).toBe(false);
  });

  it('does not match a missing app field', () => {
    const data = { check_run: {} } as unknown as WebhookPayload;
    expect(isOwnGithubAppCheckEvent(data, 'check_run', OWN_APP_ID)).toBe(false);
  });
});

describe('isRerunTriggerWebhookEvent', () => {
  it('is true for check_run.rerequested on Tribunal own check run', () => {
    const data = { check_run: { app: { id: 12345 } } } as unknown as WebhookPayload;
    expect(isRerunTriggerWebhookEvent('check_run', 'rerequested', data, OWN_APP_ID)).toBe(true);
  });

  it('is true for check_run.requested_action with the re-review identifier', () => {
    const data = {
      check_run: { app: { id: 12345 } },
      requested_action: { identifier: RE_REVIEW_ACTION_IDENTIFIER },
    } as unknown as WebhookPayload;
    expect(isRerunTriggerWebhookEvent('check_run', 'requested_action', data, OWN_APP_ID)).toBe(
      true,
    );
  });

  it('is false for check_run.requested_action with an unknown identifier', () => {
    const data = {
      check_run: { app: { id: 12345 } },
      requested_action: { identifier: 'some-other-action' },
    } as unknown as WebhookPayload;
    expect(isRerunTriggerWebhookEvent('check_run', 'requested_action', data, OWN_APP_ID)).toBe(
      false,
    );
  });

  it('is true for check_suite.rerequested on Tribunal own check suite', () => {
    const data = { check_suite: { app: { id: 12345 } } } as unknown as WebhookPayload;
    expect(isRerunTriggerWebhookEvent('check_suite', 'rerequested', data, OWN_APP_ID)).toBe(true);
  });

  it('is false when the check belongs to a different app', () => {
    const data = { check_run: { app: { id: 99999 } } } as unknown as WebhookPayload;
    expect(isRerunTriggerWebhookEvent('check_run', 'rerequested', data, OWN_APP_ID)).toBe(false);
  });

  it('is false for check_run.completed (handled by the existing completed path, not this one)', () => {
    const data = { check_run: { app: { id: 12345 } } } as unknown as WebhookPayload;
    expect(isRerunTriggerWebhookEvent('check_run', 'completed', data, OWN_APP_ID)).toBe(false);
  });

  it('is false for check_suite.requested_action (not a real GitHub action for check suites)', () => {
    const data = { check_suite: { app: { id: 12345 } } } as unknown as WebhookPayload;
    expect(isRerunTriggerWebhookEvent('check_suite', 'requested_action', data, OWN_APP_ID)).toBe(
      false,
    );
  });

  it('is false for unrelated event types', () => {
    expect(
      isRerunTriggerWebhookEvent('pull_request', 'opened', {} as WebhookPayload, OWN_APP_ID),
    ).toBe(false);
  });
});
