/**
 * E2E backdoor safety primitives.
 *
 * The `/__e2e__/*` test endpoints (see `test/end-to-end/handle.ts`) bypass
 * GitHub OAuth and seed arbitrary sessions. They are gated solely by
 * `E2E_TEST_MODE === '1'`. These helpers keep that backdoor safe:
 *
 * - `constantTimeStringEqual` compares the request secret without leaking match
 *   length through timing.
 * - `assertE2EModeNotInProduction` makes an accidental `E2E_TEST_MODE=1` in a
 *   production deployment loud and fatal at startup instead of silently live.
 *
 * CONSTRAINT: this module must NOT import SvelteKit virtual modules (`$app/*`,
 * `$env/*`). Its consumer (`test/end-to-end/handle.ts`) is excluded from the
 * unit-test runner, so these primitives are extracted here to be unit-testable
 * under the Node `server` vitest project — which cannot resolve those virtual
 * imports. Adding one would silently break `e2e-guard.test.ts`.
 */

export { constantTimeStringEqual } from '@tribunal/review-core/constant-time-string-equal';

/**
 * Assert that the E2E backdoor is never armed in a production runtime.
 *
 * If `E2E_TEST_MODE=1` ever leaks into a production deployment
 * (`NODE_ENV=production`), the `/__e2e__/*` endpoints become a live
 * authentication bypass. This guard makes that misconfiguration fail at startup
 * rather than silently exploitable.
 *
 * @throws if `NODE_ENV=production` and `E2E_TEST_MODE=1` are set together.
 */
export function assertE2EModeNotInProduction(environment: {
  NODE_ENV?: string;
  E2E_TEST_MODE?: string;
}): void {
  if (environment.NODE_ENV === 'production' && environment.E2E_TEST_MODE === '1') {
    throw new Error(
      'Refusing to start: E2E_TEST_MODE=1 is set in a production environment (NODE_ENV=production). ' +
        'The /__e2e__/* test endpoints bypass authentication and must never be reachable in production. ' +
        'Unset E2E_TEST_MODE in the production deployment.',
    );
  }
}
