# Routes

This directory contains all SvelteKit pages and endpoints for the Tribunal web app.
Routes are grouped by access level so public, authenticated, and GitHub integration
flows stay separate.

Tribunal is intentionally minimal: log in with GitHub, install the GitHub App in your
orgs, then browse your repositories and their open pull requests. There are no
workspaces, projects, or non-GitHub integrations.

## Top-Level Structure

| Path               | Purpose                            | Notes                                     |
| ------------------ | ---------------------------------- | ----------------------------------------- |
| `(public)/`        | Public legal pages                 | No auth required; prerendered             |
| `(authenticated)/` | Signed-in experiences              | Auth required; redirects to `/login`      |
| `api/`             | API endpoints                      | API-key check + GitHub webhook receiver   |
| `connect/`         | GitHub App installation flow       | GitHub only                               |
| `login/`           | GitHub OAuth login + account flows | Login, account linking, re-authentication |
| `logout/`          | Session termination                | Clears auth cookies                       |

### Route Structure Diagram

```text
src/routes/
├── (public)/                       # Public legal pages (prerendered)
│   ├── privacy-policy/
│   └── terms-of-use/
├── (authenticated)/                # Auth-required routes
│   ├── repositories/               # Installed repositories list
│   │   └── [repositoryId=int]/
│   │       └── pull-requests/      # Open pull requests for a repository
│   ├── api-keys/                   # API key management
│   └── profile/                    # User profile and account settings
├── api/
│   ├── api-keys/check/             # API key validation endpoint
│   └── webhooks/github/            # GitHub webhook receiver + handlers
├── connect/
│   └── github/                     # GitHub App install initiation + callback
├── login/
│   ├── github/                     # GitHub OAuth login + callback
│   ├── link/[provider=provider]/   # Link a provider to the account
│   └── reauthenticate/             # Re-auth for sensitive actions
└── logout/
```

## Route File Conventions

- `+page.svelte`: UI for the route.
- `+page.server.ts`: Server-side data + form actions.
- `+layout.svelte`: Shared layout and UI scaffolding.
- `+layout.server.ts`: Shared server data for child routes (the `(authenticated)`
  layout enforces auth and redirects to `/login`).
- `+server.ts`: API endpoints and OAuth/webhook handlers.
- `+error.svelte`: Error UI scoped to the route group.
- `layout.css`: Global layout CSS; imports `@tribunal/components/styles`.

## Parameter Matchers

Match URL params using the shared matchers in `src/params`:

- `[repositoryId=int]`, `[number=int]` — numeric IDs via the `int` matcher.
- `[provider=provider]` — auth providers; currently only `github`.

## Patterns to Follow

- Stream slow data by returning promises from `load` and resolve them in the client.
- Call `depends()` in `load` functions for cache invalidation after mutations (for
  example `depends('user:api-keys')`), then `invalidate()` the same key after a form
  action mutates that data.
- Keep authenticated routes inside `(authenticated)` and public content in `(public)`.
- UI components come from the `@tribunal/components` package.

## GitHub webhooks

`api/webhooks/github/+server.ts` is the single webhook receiver. It verifies the
signature, claims the delivery, stores the event, and dispatches to a typed router.
The per-event handlers live in `api/webhooks/github/handlers/`. Handlers currently
log the event rather than triggering downstream work.
