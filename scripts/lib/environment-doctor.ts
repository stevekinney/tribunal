import { ZodError } from 'zod';
import { parseWebEnvironment } from '../../applications/web/src/lib/server/environment.ts';

export type EnvironmentValueCheck = {
  level: 'success' | 'error';
  message: string;
};

/**
 * Validates environment *values* (not just presence) against the same schema the
 * web server runs at startup (TRI-44 AC10), so a misconfiguration that passes a
 * presence check but still blocks boot — an unknown `NODE_ENV`, a production
 * `DATABASE_URL` weaker than `sslmode=verify-full`, `NODE_TLS_REJECT_UNAUTHORIZED=0`,
 * or `SKIP_ENV_VALIDATION` being set — is surfaced by the doctor command instead
 * of only failing at runtime.
 *
 * Takes the environment explicitly so it is testable without mutating the
 * process; callers pass `process.env`.
 */
export function validateEnvironmentValues(
  environment: Record<string, string | undefined>,
): EnvironmentValueCheck {
  try {
    parseWebEnvironment(environment);
    return { level: 'success', message: 'Environment values pass schema validation' };
  } catch (err) {
    if (err instanceof ZodError) {
      const detail = err.issues
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('; ');
      return { level: 'error', message: `Environment values fail schema validation: ${detail}` };
    }
    // A non-Zod throw is the SKIP_ENV_VALIDATION ban (or another parser error) —
    // a real misconfiguration the doctor should report rather than swallow.
    const message = err instanceof Error ? err.message : String(err);
    return { level: 'error', message: `Environment validation error: ${message}` };
  }
}
