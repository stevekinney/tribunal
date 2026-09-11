import { z } from 'zod';
import { shouldUseNeonHttp } from '@tribunal/database/neon-host';

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
 *
 * This module imports `shouldUseNeonHttp` from `@tribunal/database/neon-host`
 * rather than the package's main entry point (`@tribunal/database`). The main
 * entry point re-exports `createDatabase` from `connection.ts`, which imports
 * `./schema` — and `./schema` pulls in `@lostgradient/mcp/oauth/postgres`,
 * which does not resolve from every context this module runs in (confirmed:
 * importing `@tribunal/database` directly here broke the Vitest `server`
 * project with "Cannot find package '@lostgradient/mcp/oauth/postgres'").
 * `@tribunal/database/neon-host` is its own module with zero other imports —
 * no drizzle-orm, no schema — so it carries none of that risk.
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
 * An optional URL that tolerates a blank value. `.env.example` ships these keys
 * present-but-empty (`BASE_URL=`), and copying it verbatim is the documented
 * setup; `z.string().url().optional()` accepts `undefined` but rejects `''`, so
 * a blank must be normalized to unset or an otherwise-valid local boot fails.
 */
const optionalUrl = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().url().optional(),
);

/**
 * Hosts for which full TLS verification is not required even in production:
 * loopback, the Docker host gateway, and private/link-local suffixes. These are
 * container smoke tests and local prod-mode runs where the database is not
 * reached over an untrusted network, so `sslmode=verify-full` (which needs a CA
 * the throwaway database does not have) must not fail the boot.
 */
function isLocalDatabaseHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '[::1]' ||
    hostname === 'host.docker.internal' ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.local')
  );
}

/**
 * Whether a production DATABASE_URL violates the TLS requirement.
 *
 * This check constrains only the `node-postgres` raw-TLS path (used for
 * non-Neon hosts; see `packages/database/src/connection.ts`). There, a remote
 * managed database must declare exactly one `sslmode=verify-full`. `require`
 * encrypts without verifying the certificate; `verify-ca` skips hostname
 * verification. Duplicated parameters must not slip through:
 * `URLSearchParams.get` returns the first value, but the pg connection-string
 * parser keeps the last, so `?sslmode=verify-full&sslmode=disable` would
 * otherwise pass here while the driver connects with `ssl: false`. A URL that
 * is not parseable is left to the `z.string().url()` field check; a local
 * host is exempt (see {@link isLocalDatabaseHost}).
 *
 * A Neon host (per {@link shouldUseNeonHttp}) is exempt from this whole check:
 * `connection.ts` routes it through `drizzle-orm/neon-http`, which connects
 * over HTTPS, not a raw Postgres TLS socket — `sslmode` is inert there, it is
 * never read by that driver. Certificate verification happens at the
 * HTTPS/fetch layer, using the runtime's built-in root CA store, the same way
 * any other HTTPS API call is verified. Asserting `sslmode=verify-full`
 * against that driver was always a false requirement (TRI-124).
 */
function productionDatabaseUrlViolatesTls(databaseUrl: string): boolean {
  if (!URL.canParse(databaseUrl)) return false;
  const url = new URL(databaseUrl);
  if (isLocalDatabaseHost(url.hostname)) return false;
  if (shouldUseNeonHttp(databaseUrl)) return false;
  const sslModes = url.searchParams.getAll('sslmode');
  return !(sslModes.length === 1 && sslModes[0] === 'verify-full');
}

const webEnvironmentObject = z.object({
  // No default (a deployment that fails to set it fails closed rather than
  // silently running as one environment while configured as another).
  NODE_ENV: z.enum(['development', 'test', 'production']),
  DATABASE_URL: z.string().url(),
  // Required at boot in production (asserted separately today via
  // assertNeonAuthConfigured); kept optional here so dev/test without it
  // still parse.
  NEON_AUTH_BASE_URL: optionalUrl,
  MCP_ENABLED: booleanFlag.default(false),
  MCP_CONFORMANCE_MODE: booleanFlag.default(false),
  // The server's reported implementation name. Read at runtime via
  // `$env/dynamic/private` in `mcp/server-identity.ts` (which keeps its own
  // fallback so it never throws at import); owned by the schema here so the
  // key is derivable — the doctor's required-list and the Turborepo
  // environment-declaration guard both enumerate `webEnvironmentKeys`.
  MCP_SERVER_NAME: z.string().optional(),
  MCP_BASE_URL: optionalUrl,
  // Optional, documented base URL (TRI-44 AC9). Nothing reads a bare BASE_URL
  // today; it is added to the schema and .env.example rather than made fatal.
  BASE_URL: optionalUrl,
  // Passed through so the production refinement can reject the value that
  // disables certificate verification process-wide.
  NODE_TLS_REJECT_UNAUTHORIZED: z.string().optional(),
  E2E_TEST_MODE: z.string().optional(),
  // adapter-node's global request-body backstop, set in deployment/fly/web.toml
  // above the /mcp per-route limit (TRI-48). adapter-node reads it from
  // process.env directly, so nothing in this schema consumes the value; it is
  // owned here only so the key is derivable for the doctor and .env.example,
  // the same way BASE_URL is.
  BODY_SIZE_LIMIT: z.string().optional(),
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

  // This constrains only the node-postgres raw-TLS path (non-Neon, non-local
  // hosts): a remote managed database reached over node-postgres in
  // production must use sslmode=verify-full. A Neon host is exempt — it
  // connects over neon-http's HTTPS transport, where sslmode is inert and
  // certificate verification happens at the HTTPS/fetch layer via the
  // runtime's built-in root store. See {@link productionDatabaseUrlViolatesTls}
  // for the full reasoning and the outage (TRI-124) this distinction fixes.
  if (productionDatabaseUrlViolatesTls(environment.DATABASE_URL)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['DATABASE_URL'],
      message:
        'Refusing to start in production without DATABASE_URL sslmode=verify-full for a non-local, non-Neon host (require encrypts without verifying the certificate; verify-ca skips hostname verification).',
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
