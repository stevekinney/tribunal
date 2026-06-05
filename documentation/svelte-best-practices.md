# Svelte and SvelteKit best practices for Tribunal

This guide consolidates the SvelteKit guidance we rely on, plus project-specific
examples drawn from the current `applications/web` codebase. It is written for
Svelte 5 (runes) and SvelteKit 2.x.

Tribunal's web app is intentionally small: log in with GitHub, install the
GitHub App in your orgs, then browse your repositories and their open pull
requests. There are no workspaces, projects, goals, agents, or AI features, so
the examples below stay close to that flat surface.

Version context:

- Svelte 5 runes are the default (`svelte: ^5.x`).
- SvelteKit 2.x (`@sveltejs/kit: ^2.x`).
- Adapter: Vercel, Node runtime (`nodejs22.x`) in
  `applications/web/svelte.config.js`.
- `experimental.async: true` (compiler) and `kit.experimental.remoteFunctions:
true` are enabled in `svelte.config.js`. We do not currently author remote
  functions; prefer form actions and endpoints.

## Execution model and boundaries

SvelteKit is a filesystem router where every route file can run on the server,
and every route file runs in the browser except `+server` files. That boundary
is the source of most production bugs.

Key rules:

- Data that crosses the server-client boundary must be serializable (devalue).
- Keep boundary data JSON-ish (convert `Date` to ISO strings, `Map`/`Set` to
  arrays, and avoid class instances).
- Use `+page.server.ts` or `+layout.server.ts` when you need secrets, DB
  access, or private env vars.
- Keep server-only modules in `applications/web/src/lib/server` and import them
  only from `.server` modules.
- Avoid browser-only globals (`window`, `document`) in server code.

Example (server-only layout enforcing auth):
`applications/web/src/routes/(authenticated)/+layout.server.ts`

```ts
import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, url }) => {
  const { user } = locals;

  if (!user) {
    const returnTo = url.pathname + url.search;
    redirect(302, `/login?returnTo=${encodeURIComponent(returnTo)}`);
  }

  return { user };
};
```

## Routing

SvelteKit routing is based on `applications/web/src/routes` and file names. We
also use route _groups_ (parenthesized segments) for layout and authorization
boundaries.

Patterns we follow:

- Authenticated UI lives in the `(authenticated)` group, which redirects
  anonymous users to `/login` in its server layout load.
- Public, static pages live in the `(public)` group (privacy policy, terms),
  which is prerendered.
- Layouts provide stable, shared data; pages provide volatile data.
- Dynamic params are validated with matchers and re-validated in server load.
- Avoid optional params unless the URL is genuinely ambiguous.
- Add scoped `+error.svelte` boundaries per major section.
- Use plain `<a>` for internal navigation unless a side effect is needed.

### Param matchers

We use matchers to keep params well-formed and route sorting predictable. The
matchers actually wired into routes are `int` (numeric repository IDs) and
`provider` (auth provider slugs).

`applications/web/src/params/int.ts`

```ts
export function match(param: string): boolean {
  return /^\d+$/.test(param);
}
```

`applications/web/src/params/provider.ts`

```ts
import type { ParamMatcher } from '@sveltejs/kit';
import { isValidProvider } from '$lib/constants/authorization-providers';

export const match: ParamMatcher = (param) => {
  return isValidProvider(param);
};
```

Routes use matchers like `[repositoryId=int]` and `[provider=provider]`.

### Error boundaries

`+error.svelte` applies to its directory and subdirectories. Keep error UI
scoped to public vs authenticated sections to avoid leaking details.

Examples:

- `applications/web/src/routes/+error.svelte`
- `applications/web/src/routes/(authenticated)/+error.svelte`

The app's `App.Error` interface (`applications/web/src/app.d.ts`) extends the
default with a `code` and a `githubAccess` payload, so error pages can render
GitHub-specific UI (for example a re-install or SSO prompt).

### Route sorting and ambiguity

SvelteKit sorts routes by specificity. Matchers outrank bare params, and
optional/rest params are lowest priority. Avoid ambiguous routes; make your
intended match the most specific path.

## Data loading

### Pick the right load type

- `+page.server.ts` / `+layout.server.ts`: DB, secrets, auth-required data.
- `+page.ts` / `+layout.ts`: safe data that can run on server or client.
- Client-only fetch: only for non-essential or user-triggered data.

Tribunal's data loads are almost all server loads, because they read from the
database and call GitHub on the user's behalf.

Example (auth check plus GitHub-backed read):
`applications/web/src/routes/(authenticated)/repositories/+page.server.ts`

```ts
export const load: PageServerLoad = async ({ locals }) => {
  const { user } = locals;
  if (!user) {
    redirect(302, '/login');
  }

  const result = await getRepositoriesForUser(user.id);

  if (!result.ok) {
    // No usable GitHub token, or GitHub was unreachable. Render a connect
    // prompt instead of a hard error so the user has an obvious next step.
    return {
      repositories: [],
      needsConnect: result.error === 'no_github_token',
      loadError: result.error === 'github_unavailable' ? result.message : null,
    };
  }

  return {
    repositories: result.repositories.map((entry) => ({
      id: entry.repository.id,
      owner: entry.repository.owner,
      name: entry.repository.name,
      defaultBranch: entry.repository.defaultBranch,
      accountLogin: entry.installation.accountLogin,
      accountAvatarUrl: entry.installation.accountAvatarUrl,
    })),
    needsConnect: false,
    loadError: null,
  };
};
```

### Authorize before you read

Re-validate access inside the load, not just in a layout. The pull-requests page
confirms the repository exists, that the user can reach it through one of their
installations, and only then lists open pull requests:
`applications/web/src/routes/(authenticated)/repositories/[repositoryId=int]/pull-requests/+page.server.ts`

```ts
const repository = await getRepositoryById(githubContext, repositoryId);
if (!repository) {
  error(404, 'Repository not found');
}

const canAccess = await userCanAccessRepository(user.id, repositoryId);
if (!canAccess) {
  error(404, 'Repository not found');
}
```

### Use `event.fetch`

Inside `load`, prefer `event.fetch` over `fetch`. It reuses SSR responses during
hydration, forwards cookies for same-origin requests, and short-circuits
internal requests.

Cookie forwarding details:

- Same-origin `event.fetch` forwards `cookie` and `authorization` headers unless
  you set `credentials: 'omit'`.
- Cross-origin cookies are forwarded only for subdomains of the app.
- For sibling subdomains, use `handleFetch` to attach cookies manually.

### Headers and caching

`setHeaders` is limited:

- You cannot set `set-cookie` via `setHeaders`.
- You cannot call it after the response has started streaming.
- You cannot override headers returned by `fetch`, except allowed names like
  `cache-control`.

Prefer to set cache headers in endpoints (`+server.ts`) and let `load` inherit
them, rather than trying to rewrite all headers in `load`.

### Parallelism and waterfalls

Use `Promise.all` for independent requests, and avoid `await parent()` unless
the child truly needs parent data. If you must call `parent()`, do it after
independent fetches so you do not serially block other requests.

For secondary operations that must not fail the primary request, prefer
`Promise.allSettled` and log the rejected entries. The GitHub webhook handler
uses this pattern when it invalidates downstream caches: a failed invalidation
is logged but does not fail the webhook response.

### Auth checks without waterfalls

Request-scoped identity is set in `applications/web/src/hooks.server.ts` and
exposed on `event.locals.user` / `event.locals.neonSession`. Reject unauthorized
requests early in each load. Avoid forcing child loads to `await parent()` just
to discover auth, unless they truly need parent data.

### Streaming non-essential data

SvelteKit can stream slow, non-essential data from a server `load` by returning
a promise instead of an awaited value. Tribunal's current loads await everything
before returning, so we have no streaming loads today — but if you add one, keep
these constraints in mind:

- Streaming only works for server `load` when JS is enabled.
- Promises returned from universal `load` do not stream during SSR; they are
  recreated in the browser.
- You cannot change headers or redirect inside streamed promises.
- Handle the promise in the component with cancellation (set a `cancelled` flag
  in the `$effect` cleanup) and reset loading state when the effect re-runs.

### Client-side fetch safety

If you fetch in components:

- Abort requests on destroy (use `AbortController` in an effect cleanup).
- Avoid duplicate client fetches for data already returned from `load`.
- Surface loading and error UI so failures do not blank the page.

### Dependency tracking and invalidation

Use explicit `depends` keys for anything you plan to invalidate, and use the
same string with `invalidate` in the component after a mutation. The API keys
page is the live example: the load declares a dependency, and the create form
invalidates it after a successful submission so the list re-fetches.

`applications/web/src/routes/(authenticated)/api-keys/+page.server.ts`

```ts
export const load: PageServerLoad = async ({ locals, depends }) => {
  depends('user:api-keys');

  const apiKeys = await listUserApiKeys(locals.user!.id);
  return { apiKeys };
};
```

`applications/web/src/routes/(authenticated)/api-keys/components/create-api-key-form.svelte`

```ts
import { invalidate } from '$app/navigation';

// after a successful create:
invalidate('user:api-keys');
```

Notes:

- Server `load` functions do not automatically depend on fetched URLs. If you
  want a server load to rerun when you invalidate a URL, call `depends(url)`.
- Use stable custom identifiers with a `[a-z]+:` prefix (for example
  `user:api-keys`).

### URL dependency tracking

Reading `url.searchParams` inside `load` creates a dependency. If a query param
should not trigger reloads (tracking params, marketing tags), wrap the read with
`untrack()` to avoid accidental reruns.

### Normalize data in load

Filter and normalize data in `load` so components can initialize with plain
values and remain invalidation-friendly. Both the repositories and pull-requests
loads above map raw service results into flat, serializable shapes before
returning them, which keeps components simple and the boundary data JSON-ish.

### Error handling in load

- Throw `error()` or `redirect()` early to fail fast before slow calls.
- Provide friendly loading and error UI when streaming secondary data.
- Keep `load` functions pure; avoid side effects or store mutations.

## Form actions and progressive enhancement

Form actions are the production-stable way to mutate server state. Always:

- Validate input inside the action (we use Zod schemas from `@tribunal/database`, in `packages/database/src/validation/`).
- Re-check auth and permissions (actions do not inherit layout auth).
- Return structured errors with `fail` for re-rendering.
- Never store per-user action results in module scope.

The API keys page is the canonical example. Each named action re-checks auth,
validates form data with a schema, and returns `fail(...)` with a structured
payload on error:
`applications/web/src/routes/(authenticated)/api-keys/+page.server.ts`

```ts
export const actions = {
  createApiKey: async ({ request, locals }) => {
    if (!locals.user) {
      error(401, 'Authentication required');
    }

    const formData = await request.formData();
    const result = createUserApiKeySchema.safeParse({ name: formData.get('name') });

    if (!result.success) {
      return fail(400, {
        action: 'createApiKey',
        error: 'INVALID_INPUT',
        message: result.error.issues[0].message,
        field: 'name',
      });
    }

    // ...create the key and return a structured success payload
  },
  // rotateApiKey, revokeApiKey ...
} satisfies Actions;
```

Named actions are invoked via `action="?/createApiKey"` and friends.

Use `use:enhance` for progressive enhancement where JS should improve UX but is
not required. If you disable CSR (`export const csr = false`), scripts are
stripped and `use:enhance` will not run — keep that in mind for any route that
also defines actions. The `(public)` group sets `csr = false`, but those pages
have no actions.

## State management (Svelte 5 runes)

### Avoid shared server state

Do not store per-user data in module scope. Use `event.locals` (set in
`applications/web/src/hooks.server.ts`) or return data from `load`.

### Use runes correctly

- `$state` for local mutable state.
- `$state.raw` for arrays/objects where you do not need deep reactivity.
- `$derived` for computed values. Do not mutate state inside `$derived`.
- `$effect` for side effects only. Clean up timers/observers and avoid
  read/write loops (use `untrack` for reads that should not re-run effects).
- `$bindable` for two-way binding when a child must own the mutation.
- Use `untrack` only for simple value initialization; move filtering and Set
  creation into `load` so invalidation works correctly.

Example (`$derived` from `data` in a page component):
`applications/web/src/routes/(authenticated)/repositories/+page.svelte`

```ts
const repositories = $derived(data.repositories);
```

### Layout reuse and derived values

Layouts and pages are reused across navigation. If a derived value depends on
`data`, make it reactive (use `$derived`) or force a remount with a keyed block
when appropriate.

### App state and context

- Prefer `$app/state` (`page`, `navigating`, `updated`) over `$app/stores`. Our
  components read `page` from `$app/state` (for example the login page reads
  query params this way).
- When using context, pass a function to `setContext` for reactivity and keep
  data flow top-down to avoid SSR hydration flashes.
- Persist shareable state in the URL (filters, sort, tabs).
- Use snapshots for ephemeral UI state that should survive back/forward.

## Debugging

### Common issues and fixes

#### Infinite `$effect` loops

```ts
// BAD: count triggers effect, effect writes count
$effect(() => {
  count = count + 1;
});

// GOOD: Use non-reactive bookkeeping
let previous = 0;
$effect(() => {
  if (count !== previous) {
    console.log('changed');
    previous = count;
  }
});
```

#### Hydration mismatches

1. Check for `typeof window` in render (use `browser` from `$app/environment`).
2. Look for randomness or `Date.now()` in initial render.
3. Ensure streamed data resolves before mount.

#### Form action not returning data

```ts
// BAD: Throws, shows error boundary
if (!valid) throw new Error('Invalid');

// GOOD: Returns to component
if (!valid) return fail(400, { error: 'Invalid' });
```

#### Component not re-rendering

- Check if using `$derived` for computed values.
- Verify `$state` is used for mutable data.
- Check if data is coming from `load` (reactive by default).

## Page options

Use page options intentionally:

- `prerender`: `true` for static content (the `(public)` group uses this).
- `ssr = false`: SPA mode, generally not recommended for SEO or performance.
- `csr = false`: HTML-only page, no JS, no `use:enhance` (the `(public)` group
  uses this).
- `trailingSlash`: be consistent to avoid SEO duplication.
- Redirect-only routes belong in `+page.server.ts`; add `prerender = true` if
  the redirect is static.

If you compute page options dynamically, avoid browser-only imports at module
scope because SvelteKit may evaluate options on the server.

For parameterized routes, use `entries` to control what gets prerendered. Use
`config` for deployment-level settings (keep it shallow and predictable).

## Navigation and link options

- Prefer plain `<a>` for internal links unless you need a side effect.
- The root layout opts into preloading on hover via
  `data-sveltekit-preload-data="hover"` in `applications/web/src/app.html`.
- Programmatic equivalents live in `$app/navigation` (`preloadData`,
  `preloadCode`, `invalidate`, `goto`).
- Avoid unnecessary `resolve()` calls when paths are already absolute.

## Accessibility

SvelteKit provides an accessible foundation (route announcements, focus
management, and compiler a11y warnings), but we are still responsible for
accessible UI.

### Route announcements and titles

SvelteKit announces the current page via a live region that reads the document
`<title>` after client-side navigation. Every page should set a unique,
descriptive title.

Example:
`applications/web/src/routes/login/+page.svelte`

```svelte
<svelte:head>
  <title>Sign in - Tribunal</title>
</svelte:head>
```

### Focus management

SvelteKit focuses the `<body>` after navigation and enhanced form submissions.
If you use `autofocus`, do so intentionally and verify it does not confuse
assistive tech users. For custom focus handling, use `afterNavigate`. If you
call `goto`, the `keepFocus` option preserves focus; only enable it when you are
sure the focused element still exists after navigation.

### Document language

The root `<html lang>` attribute is set in `applications/web/src/app.html`. If
the app becomes multi-language, switch this per request via `transformPageChunk`
in hooks.

Current default (`applications/web/src/app.html`): `<html lang="en">`.

### Tooling and tests

- Svelte compiler warnings flag common a11y issues at build time.
- The accessibility Playwright project runs against Storybook for isolated
  component testing. Run it from `applications/web`:
  `bun run scripts/run-playwright.ts --project=accessibility`

## Performance

SvelteKit already provides:

- Code-splitting so only route code loads.
- Asset preloading to avoid waterfalls.
- File hashing for long-term caching.
- Request coalescing for data from multiple server loads.
- Parallel loading for universal loads.
- Data inlining so SSR fetches are reused on hydration.
- Conservative invalidation so loads rerun only when needed.
- Prerendering for static routes.
- Link preloading for anticipated navigations.

For production performance, pay attention to:

### Diagnostics

Test performance on production builds, not dev:

```sh
bun --cwd applications/web run build
bun --cwd applications/web run preview
```

Use Lighthouse or WebPageTest, and use browser devtools to spot waterfalls.

### Instrumentation

If an API call is slow, narrow it down with timing logs or tracing. Requests
already carry a per-request `correlationId` and `requestId` (set in
`hooks.server.ts` and echoed back as `X-Correlation-ID` / `X-Request-ID`
response headers), which helps trace a slow request end to end.

### Assets

- Images: compress and use modern formats. Consider `@sveltejs/enhanced-img` if
  you need responsive images or automatic optimization.
- Videos: compress, prefer `webm`/`mp4`, lazy load with `preload="none"`, and
  strip audio tracks if muted.
- Fonts: SvelteKit does not preload fonts by default. If you preload fonts, do
  it surgically, and subset fonts when possible. A preload filter can be added
  in `handle` via `resolve`.

Example preload filter (pattern only):

```ts
export const handle: Handle = async ({ event, resolve }) => {
  return resolve(event, {
    preload: ({ type, path }) => type === 'js' || path.includes('/fonts/'),
  });
};
```

### Reducing code size

- Prefer the latest Svelte (we are on Svelte 5).
- Use `rollup-plugin-visualizer` or inspect build output to locate large
  bundles.
- Minimize third-party scripts; prefer server-side work where possible.
- Use dynamic `import(...)` for code that is conditional or rarely used.

### Navigation and waterfalls

- Use `data-sveltekit-preload-data` for high-intent links.
- Avoid sequential backend calls; do joined queries when possible.
- Avoid SPA mode unless necessary; it adds extra round trips before first paint.

### Hosting

Keep frontend and backend in the same region when possible. We deploy with the
Vercel adapter (`svelte.config.js`) on the `nodejs22.x` runtime. Ensure HTTP/2+
is available so split bundles can load in parallel.

## Snapshots (history state)

Ephemeral DOM state (scroll positions, form input) is discarded on navigation.
Use snapshots to preserve UI state across back/forward navigation or reloads.

Pattern (add to `+page.svelte` or `+layout.svelte`):

```svelte
<script lang="ts">
  import type { Snapshot } from './$types';

  let comment = $state('');

  export const snapshot: Snapshot<string> = {
    capture: () => comment,
    restore: (value) => {
      comment = value;
    },
  };
</script>
```

Guidelines:

- Keep snapshot data JSON-serializable (stored in sessionStorage).
- Avoid large objects; snapshots are retained for the session.
- Use snapshots for forms where returning to a page should restore in-progress
  input.

## Shallow routing

Shallow routing is JS-dependent and `page.state` is empty on SSR and initial
load. Use it for UI polish (modals, drawers) but always provide a fallback that
still works without JS.

## Hooks (app-wide lifecycle)

SvelteKit supports three hook entry points (`hooks.server`, `hooks.client`, and
a shared `hooks`). This repository implements two:

- `applications/web/src/hooks.server.ts`
- `applications/web/src/hooks.client.ts`

Server hooks run when the application starts. You can relocate them with
`config.kit.files.hooks`. Requests for static assets and already-prerendered
pages do not go through SvelteKit `handle`.

### handle and locals

`hooks.server.ts` composes several `handle` functions with the `sequence`
helper from `@sveltejs/kit/hooks`:

- `correlationHandle`: sets `correlationId` and `requestId` on `event.locals`
  and copies them onto response headers.
- `e2eHandle`: a pass-through in production; in E2E mode it intercepts
  `/__e2e__/*` and validates test-only bridge tokens against per-worker databases.
- `respondWithJsonForApiEndpoints`: ensures `/api/**` errors return JSON.
- `authHandle`: validates the Neon Auth bridge cookie and sets
  `event.locals.user` and `event.locals.neonSession`.

Example (bridge cookie validation in `authHandle`):
`applications/web/src/hooks.server.ts`

```ts
const neonAuthToken = event.cookies.get(neonAuthTokenCookieName);

if (!neonAuthToken) {
  event.locals.user = null;
  event.locals.neonSession = null;
  return resolve(event);
}

const { user, neonSession } = await createNeonSessionFromToken(neonAuthToken);
event.locals.user = user;
event.locals.neonSession = neonSession;
```

When returning a custom `Response` from `handle`, SvelteKit does not apply
`event.cookies` changes, so set `Set-Cookie` manually. `handle` also runs during
prerender — gate build-only logic with `import { building } from
'$app/environment'`. Be careful modifying headers on a `Response` returned by
`resolve`; some responses are immutable (for example `Response.redirect`). Clone
before mutating if needed.

`resolve` options let you fine-tune responses:

- `transformPageChunk` to post-process HTML.
- `filterSerializedResponseHeaders` to include specific headers in serialized
  fetch responses.
- `preload` to control which assets are preloaded.

### handleFetch

Use `handleFetch` to rewrite requests or forward cookies in SSR. This matters
when your API is on a sibling subdomain and cookies are not forwarded by
default, or when you want to route SSR requests to internal services without
public network hops.

### handleError

`hooks.client.ts` implements `handleError` (`HandleClientError`): it logs the
error and returns a safe, structured object (`{ message, code: 'CLIENT_ERROR'
}`) that `+error.svelte` can render. Do not throw inside `handleError`.
`handleError` is not called for expected errors thrown with `error(...)`. A
server-side `handleError` (`HandleServerError`) can be added the same way if we
need structured server error logging.

### reroute and transport

Use `reroute` only for pure URL-to-route remapping, and keep it fast. Use
`transport` only if you need custom serialization for complex types returned
from `load` or actions.

## Production-first decision framework

Reads:

- Secrets/DB/GitHub: `+page.server.ts` or `+layout.server.ts`.
- Shared, safe data: universal `load`.
- Non-essential: stream with promises.

Writes:

- Form submissions: form actions + `use:enhance`.
- Imperative events: use endpoints or actions, avoid client-only fetches when
  progressive enhancement matters.

State:

- Local UI state: `$state`.
- Derived UI state: `$derived`.
- Cross-request state: cookies, DB, `event.locals`.
- History state: snapshots.

## Remote functions (enabled, unused)

Remote functions are enabled in `svelte.config.js`
(`kit.experimental.remoteFunctions: true`), but we do not author any today.
Prefer form actions and `+server.ts` endpoints unless we explicitly opt in and
accept the change risk. If you do add a `.remote.ts` file, remember:

- Functions always run on the server. Arguments and return values are serialized
  with `devalue`; use transport hooks for custom types.
- `query` (reads), `form` (progressive-enhancement writes), `command`
  (imperative writes), and `prerender` (build-time data) are the available
  kinds.
- Validate arguments with schemas; invalid input returns 400 by default. Do not
  authorize based on `route`, `params`, or `url` — use server-side identity
  checks (`event.locals.user`) instead.
