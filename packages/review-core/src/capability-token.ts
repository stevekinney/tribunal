import { createHmac } from 'node:crypto';
import { z } from 'zod';
import { constantTimeStringEqual } from './constant-time-string-equal';

const capabilityTokenVersion = 1;

export const proxyPermissionSchema = z.enum(['github:read', 'anthropic:invoke']);

export type ProxyPermission = z.infer<typeof proxyPermissionSchema>;

export const capabilityTokenClaimsSchema = z.object({
  version: z.literal(capabilityTokenVersion),
  runId: z.string().min(1),
  userId: z.number().int().positive(),
  repositoryId: z.number().int().positive(),
  installationId: z.number().int().positive(),
  repositoryOwner: z.string().min(1),
  repositoryName: z.string().min(1),
  permissions: z.array(proxyPermissionSchema).min(1),
  expiresAtEpochSeconds: z.number().int().positive(),
});

export type CapabilityTokenClaims = z.infer<typeof capabilityTokenClaimsSchema>;

export type CapabilityTokenVerificationResult =
  | { ok: true; claims: CapabilityTokenClaims }
  | { ok: false; reason: 'malformed' | 'invalid_signature' | 'expired' };

export function mintCapabilityToken(claims: CapabilityTokenClaims, signingKey: string): string {
  const validatedClaims = capabilityTokenClaimsSchema.parse(claims);
  const payloadSegment = encodeBase64Url(JSON.stringify(validatedClaims));
  const signatureSegment = signPayloadSegment(payloadSegment, signingKey);

  return `${payloadSegment}.${signatureSegment}`;
}

export function verifyCapabilityToken(
  token: string,
  signingKey: string,
  now: Date,
): CapabilityTokenVerificationResult {
  const segments = token.split('.');
  if (segments.length !== 2) {
    return { ok: false, reason: 'malformed' };
  }

  const [payloadSegment, signatureSegment] = segments;
  if (!payloadSegment || !signatureSegment) {
    return { ok: false, reason: 'malformed' };
  }

  const expectedSignatureSegment = signPayloadSegment(payloadSegment, signingKey);
  if (!constantTimeStringEqual(signatureSegment, expectedSignatureSegment)) {
    return { ok: false, reason: 'invalid_signature' };
  }

  const claims = parseClaims(payloadSegment);
  if (!claims) {
    return { ok: false, reason: 'malformed' };
  }

  const nowEpochSeconds = Math.floor(now.getTime() / 1000);
  if (claims.expiresAtEpochSeconds <= nowEpochSeconds) {
    return { ok: false, reason: 'expired' };
  }

  return { ok: true, claims };
}

export function hasProxyPermission(
  claims: CapabilityTokenClaims,
  permission: ProxyPermission,
): boolean {
  return claims.permissions.includes(permission);
}

function parseClaims(payloadSegment: string): CapabilityTokenClaims | null {
  try {
    const payloadJson = Buffer.from(payloadSegment, 'base64url').toString('utf8');
    const payload: unknown = JSON.parse(payloadJson);
    const result = capabilityTokenClaimsSchema.safeParse(payload);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

function signPayloadSegment(payloadSegment: string, signingKey: string): string {
  return createHmac('sha256', signingKey).update(payloadSegment).digest('base64url');
}

function encodeBase64Url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}
