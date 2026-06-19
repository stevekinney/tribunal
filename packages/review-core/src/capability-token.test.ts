import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  type CapabilityTokenClaims,
  hasProxyPermission,
  mintCapabilityToken,
  verifyCapabilityToken,
} from './capability-token';

const claims: CapabilityTokenClaims = {
  version: 1,
  runId: 'run:42:7:abc:opened',
  userId: 1,
  repositoryId: 42,
  installationId: 1001,
  repositoryOwner: 'lostgradient',
  repositoryName: 'tribunal',
  permissions: ['github:read', 'anthropic:invoke'],
  expiresAtEpochSeconds: 1_782_000_000,
};

describe('capability tokens', () => {
  it('mints signed tokens and verifies their claims', () => {
    const token = mintCapabilityToken(claims, 'signing-key');

    expect(token).toContain('.');
    expect(
      verifyCapabilityToken(token, 'signing-key', new Date('2026-06-17T12:00:00.000Z')),
    ).toEqual({ ok: true, claims });
    expect(hasProxyPermission(claims, 'github:read')).toBe(true);
  });

  it('rejects malformed, tampered, and expired tokens', () => {
    const token = mintCapabilityToken(claims, 'signing-key');
    const [payloadSegment] = token.split('.');

    expect(verifyCapabilityToken('not-a-token', 'signing-key', new Date())).toEqual({
      ok: false,
      reason: 'malformed',
    });
    expect(verifyCapabilityToken('.', 'signing-key', new Date())).toEqual({
      ok: false,
      reason: 'malformed',
    });
    expect(verifyCapabilityToken(`${payloadSegment}.bad`, 'signing-key', new Date())).toEqual({
      ok: false,
      reason: 'invalid_signature',
    });
    expect(
      verifyCapabilityToken(token, 'signing-key', new Date('2026-07-01T12:00:00.000Z')),
    ).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects signed payloads that are not valid claims', () => {
    const invalidJsonPayload = Buffer.from('not-json', 'utf8').toString('base64url');
    const invalidJsonToken = `${invalidJsonPayload}.${signPayloadSegment(
      invalidJsonPayload,
      'signing-key',
    )}`;
    const invalidClaimsPayload = Buffer.from(
      JSON.stringify({ ...claims, repositoryId: 0 }),
      'utf8',
    ).toString('base64url');
    const invalidClaimsToken = `${invalidClaimsPayload}.${signPayloadSegment(
      invalidClaimsPayload,
      'signing-key',
    )}`;

    expect(verifyCapabilityToken(invalidJsonToken, 'signing-key', new Date())).toEqual({
      ok: false,
      reason: 'malformed',
    });
    expect(verifyCapabilityToken(invalidClaimsToken, 'signing-key', new Date())).toEqual({
      ok: false,
      reason: 'malformed',
    });
  });
});

function signPayloadSegment(payloadSegment: string, signingKey: string): string {
  return createHmac('sha256', signingKey).update(payloadSegment).digest('base64url');
}
