import { z } from 'zod';

/**
 * Environment validation for the web application (TRI-44).
 *
 * Tribunal's web app reads its environment ad hoc through SvelteKit's
 * `$env/dynamic/private` across many modules; this module adds a single Zod
 * contract with the fail-closed invariants each of Protokit's environment
 * failures taught, and `scripts/doctor.ts` derives its required-variable list
 * from the same schema (so a newly required variable is caught automatically).
 *
 * CONSTRAINT: this module must NOT import SvelteKit virtual modules (`$app/*`,
 * `$env/*`). It takes an injected environment record so it stays unit-testable
 * under the Node `server` vitest project and importable by `scripts/doctor.ts`
 * under Bun — both of which cannot resolve those virtual imports. This mirrors
 * the same constraint documented on `e2e-guard.ts`. The boot call site
 * (`hooks.server.ts`) is what reads the ambient environment and passes it in.
 */

/**
 * A strict boolean flag: only the literal strings `"true"` and `"false"`.
 *
 * Never `z.coerce.boolean()` on a security-relevant flag — `Boolean("false")`
 * is `true`, so a flag a deployment set to `"false"` would be silently enabled.
 * Deliberately stricter than the engine's flag helper (which also accepts
 * `"1"`/`"0"`): a security flag should have exactly one spelling for each state.
 */
const booleanFlag = z.enum(['true', 'false']).transform((value) => value === 'true');

/**
 * Neon requires full certificate + hostname verification in production.
 *
 * Requires exactly one `sslmode` equal to `verify-full`. A duplicated parameter
 * (`?sslmode=verify-full&sslmode=disable`) must not pass: `URLSearchParams.get`
 * returns the first value, but the pg connection-string parser keeps the last,
 * so trusting the first would let the driver silently connect with `ssl: false`.
 */
function databaseUrlHasVerifyFullSslMode(databaseUrl: string): boolean {
  try {
    const sslModes = new URL(databaseUrl).searchParams.getAll('sslmode');
    return sslModes.length === 1 && sslModes[0] === 'verify-full';
  } catch {
    return false;
  }
}

const webEnvironmentObject = z.object({
  // No default (a deployment that fails to set it fails closed rather than
  // silently running as one environment while configured as another).
  NODE_ENV: z.enum(['development', 'test', 'production']),
  DATABASE_URL: z.string().url(),
  // Required at boot in production (asserted separately today via
  // assertNeonAuthConfigured); kept optional here so dev/test without it
  // still parse.
  NEON_AUTH_BASE_URL: z.string().url().optional(),
  MCP_ENABLED: booleanFlag.default(false),
  MCP_CONFORMANCE_MODE: booleanFlag.default(false),
  MCP_BASE_URL: z.string().url().optional(),
  // Optional, documented base URL (TRI-44 AC9). Nothing reads a bare BASE_URL
  // today; it is added to the schema and .env.example rather than made fatal.
  BASE_URL: z.string().url().optional(),
  // Passed through so the production refinement can reject the value that
  // disables certificate verification process-wide.
  NODE_TLS_REJECT_UNAUTHORIZED: z.string().optional(),
  E2E_TEST_MODE: z.string().optional(),
});

/** The full schema: the object plus the production fail-closed refinements. */
export const webEnvironmentSchema = webEnvironmentObject.superRefine((environment, context) => {
  if (environment.NODE_ENV !== 'production') return;

  // NODE_TLS_REJECT_UNAUTHORIZED=0 defeats every TLS certificate check in the
  // process regardless of any individual connection string.
  if (environment.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['NODE_TLS_REJECT_UNAUTHORIZED'],
      message:
        'Refusing to start in production with NODE_TLS_REJECT_UNAUTHORIZED=0: it disables all TLS certificate verification process-wide.',
    });
  }

  // sslmode=require encrypts without verifying the certificate; verify-ca
  // skips hostname verification. Production requires verify-full.
  if (!databaseUrlHasVerifyFullSslMode(environment.DATABASE_URL)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['DATABASE_URL'],
      message:
        'Refusing to start in production without DATABASE_URL sslmode=verify-full (require encrypts without verifying the certificate; verify-ca skips hostname verification).',
    });
  }
});

export type WebEnvironment = z.infer<typeof webEnvironmentSchema>;

/** The environment variables this schema owns, for `scripts/doctor.ts` to derive from. */
export const webEnvironmentKeys = Object.keys(
  webEnvironmentObject.shape,
) as (keyof WebEnvironment)[];

/**
 * The variables that must be present for the web app to boot, derived from the
 * schema rather than hand-maintained: a field is required unless its Zod type
 * accepts `undefined` (optional or defaulted).
 */
export const webRequiredEnvironmentKeys = webEnvironmentKeys.filter(
  (key) => !webEnvironmentObject.shape[key].safeParse(undefined).success,
);

/**
 * Validates the web application's environment.
 *
 * @throws if `SKIP_ENV_VALIDATION` is set at all — bypassing the schema also
 * bypasses its `.default()` values, and in Protokit that produced `undefined`
 * window seconds that became the literal string `"NaN"` fed to Redis's Lua
 * `tonumber`, 500ing every rate-limited route. There is no safe way to skip.
 */
export function parseWebEnvironment(
  environment: Record<string, string | undefined>,
): WebEnvironment {
  if (environment['SKIP_ENV_VALIDATION'] !== undefined) {
    throw new Error(
      'Refusing to start: SKIP_ENV_VALIDATION is set. Bypassing environment validation also bypasses schema defaults and fail-closed checks; fix the environment instead.',
    );
  }
  return webEnvironmentSchema.parse(environment);
}
