import { errors as joseErrors } from 'jose';

/**
 * Thrown when session validation cannot be completed because of an
 * infrastructure failure (the Neon Auth JWKS endpoint or transport, or the
 * database) rather than because the presented token itself is invalid.
 * Callers must NOT clear the auth cookie for this error -- the session may
 * still be good; only degrade the current request and let the client retry.
 */
export class TransientAuthInfrastructureError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'TransientAuthInfrastructureError';
  }
}

/**
 * Distinguishes an infrastructure failure encountered while verifying a
 * Neon Auth token from a genuinely invalid token.
 *
 * `getKey` (the JWKS fetcher passed to `jwtVerify`) is the only code path
 * inside the verification call that isn't controlled by jose itself: every
 * problem with the token's format, signature, or claims is always thrown as
 * a `jose.errors.JOSEError` subclass. Anything else -- on Node/undici a bare
 * `TypeError`, on Bun (this app's production runtime) a plain `Error` with a
 * `code` such as `"ConnectionRefused"` (Bun does not throw `TypeError` for
 * network failures; verified empirically against Bun 1.3) -- can only
 * originate from the transport call itself, regardless of runtime.
 *
 * `JWKSTimeout` is jose's own typed error for a JWKS fetch that timed out.
 * A bare `JOSEError` (not one of its named subclasses) is what jose throws
 * when the JWKS endpoint responds with a non-200 status or unparseable
 * JSON -- the identity provider having a bad day, not evidence the token is
 * invalid. `JWKSInvalid` is the same kind of failure one step later: the
 * response *was* 200 and valid JSON, but the JWKS document itself doesn't
 * structurally hold together (e.g. missing/malformed `keys`) -- jose never
 * even reaches the point of checking the presented token's `kid` against it,
 * so this can only be Neon Auth's key-set infrastructure having a bad day,
 * never evidence about the token.
 *
 * Every other error -- `JWTExpired`, `JWTClaimValidationFailed`,
 * `JWSSignatureVerificationFailed`, `JWTInvalid`, `JWSInvalid`,
 * `JWKSNoMatchingKey`, `JWKSMultipleMatchingKeys`, etc. -- is a deliberate,
 * typed statement from jose that the *token* is bad (including, deliberately,
 * "no key in an otherwise-valid JWKS matches this token's `kid`", which could
 * be a legitimate key rotation race but could equally be a forged `kid`
 * probing for a bypass) and is treated as invalid by default.
 */
export function isTransientJwksFailure(candidate: unknown): boolean {
  if (candidate instanceof joseErrors.JWKSTimeout) return true;
  if (candidate instanceof joseErrors.JWKSInvalid) return true;
  if (candidate instanceof joseErrors.JOSEError) {
    return candidate.constructor === joseErrors.JOSEError;
  }

  return true;
}

/**
 * Summarizes a token verification failure for logging without leaking the
 * token or decoded claims. Only called with the `JOSEError` that
 * `isTransientJwksFailure` has already classified as a genuine token
 * rejection (never a transient one). `JWTExpired` and
 * `JWTClaimValidationFailed` carry a `.payload` field with the full decoded
 * claim set (including email) -- that field must never be logged.
 */
export function describeAuthFailureForLogging(candidate: joseErrors.JOSEError): {
  name: string;
  code: string;
  claim?: string;
  reason?: string;
  message: string;
} {
  if (
    candidate instanceof joseErrors.JWTClaimValidationFailed ||
    candidate instanceof joseErrors.JWTExpired
  ) {
    return {
      name: candidate.constructor.name,
      code: candidate.code,
      claim: candidate.claim,
      reason: candidate.reason,
      message: candidate.message,
    };
  }

  return { name: candidate.constructor.name, code: candidate.code, message: candidate.message };
}
