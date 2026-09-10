/**
 * Whether a connection string routes to Neon's `neon-http` driver (HTTPS
 * transport) rather than `node-postgres` (raw TLS). See `connection.ts` for
 * where this decides the actual driver.
 *
 * Deliberately its own module with no other imports (not `drizzle-orm`, not
 * `./schema`): `applications/web/src/lib/server/environment.ts` needs this
 * predicate but must stay free of SvelteKit virtual-module imports and of the
 * package's schema import graph — `./schema` pulls in `@lostgradient/mcp`
 * subpaths that are not resolvable from every context `environment.ts` runs
 * in (TRI-124). Importing `@tribunal/database`'s main entry point (which
 * re-exports `createDatabase` from `connection.ts`, which imports
 * `./schema`) would drag that whole graph in; importing this module directly
 * (`@tribunal/database/neon-host`) does not.
 *
 * A total function: an unparseable connection string returns `false` rather
 * than throwing, since this is exported as a general-purpose boolean
 * predicate and a caller should not need to guard it with `URL.canParse`
 * first (`connection.ts`'s own `connect()` never did, and now that this is a
 * public, reusable export, other callers should not have to either).
 *
 * Requires a `postgres:`/`postgresql:` scheme, not just a matching hostname.
 * Without this, a value like `https://db.example.neon.tech/main` — which
 * `z.string().url()` accepts as a generically valid URL — would match on
 * hostname alone. In `environment.ts`, that would exempt a value from the
 * production TLS check even though it isn't a valid PostgreSQL connection
 * string at all, deferring the real failure to first database use instead of
 * environment validation at boot.
 */
export function shouldUseNeonHttp(connectionString: string): boolean {
  if (!URL.canParse(connectionString)) return false;
  const parsed = new URL(connectionString);
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') return false;
  return parsed.hostname.endsWith('.neon.tech') || parsed.hostname.endsWith('.neon.build');
}
