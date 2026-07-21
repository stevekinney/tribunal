import { describe, expect, it } from 'vitest';
import { isInstallationUnsuspendEvent } from './validate-github-webhook.js';
import {
  createInstallationSuspendEvent,
  createInstallationUnsuspendEvent,
} from 'github-webhook-schemas/fixtures';

describe('isInstallationUnsuspendEvent', () => {
  it('accepts installation.unsuspend payloads with null suspension fields', () => {
    const payload = createInstallationUnsuspendEvent({ installation: { id: 12345 } });

    expect(isInstallationUnsuspendEvent(payload)).toBe(true);
  });

  it('rejects installation.unsuspend payloads with non-null suspended_at', () => {
    const payload = createInstallationUnsuspendEvent({ installation: { id: 12345 } });
    const invalidPayload = {
      ...payload,
      installation: {
        ...payload.installation,
        suspended_at: '2024-01-01T00:00:00Z',
      },
    };

    expect(isInstallationUnsuspendEvent(invalidPayload)).toBe(false);
  });

  it('rejects other installation actions', () => {
    const payload = createInstallationSuspendEvent({ installation: { id: 12345 } });

    expect(isInstallationUnsuspendEvent(payload)).toBe(false);
  });
});
