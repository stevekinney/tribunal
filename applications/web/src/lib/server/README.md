# Server module overview

`src/lib/server` contains server-only code. It can only be imported from
`+page.server.ts`, `+layout.server.ts`, `+server.ts`, hooks, or other server
modules. Importing any of it from client code breaks the build.

## Directory structure

```
server/
├── api-keys/       # Per-user API key creation, hashing, and auth
├── auth/           # GitHub OAuth login, sessions, account providers
├── database/       # Drizzle connection (re-exports @tribunal/database)
├── github/         # GitHub App, OAuth access checks, webhooks
├── rate-limit/     # Rate limit bucket policies
└── *.ts            # Standalone helpers
```

## Standalone modules

| File                | Purpose                                                        |
| ------------------- | -------------------------------------------------------------- |
| `repositories.ts`   | Flat-model repository resolution for the authenticated user    |
| `github-context.ts` | Wires SvelteKit singletons into the `@tribunal/github` context |
| `redis.ts`          | Cache client built from `@tribunal/github/cache`               |
| `encryption.ts`     | AES-256-GCM encryption, SHA-256 hashing, token generation      |
| `logger.ts`         | Structured logging with redaction of sensitive fields          |
| `rate-limit.ts`     | In-memory rate limiting for authenticated endpoints            |
| `validation.ts`     | Shared request validation helpers                              |

## Data model and core flow

The data model is flat:

```
user -> github_installation -> github_installation_repository -> repository -> pull_request
```

A user "has" a repository when they can access the GitHub App installation
(verified live against the user's GitHub OAuth token) and an active link row in
`github_installation_repository` joins that installation to a `repository`
record. See `repositories.ts` for the resolution logic.

GitHub is the only integration. Authentication is GitHub OAuth (identity), and
repository access plus webhooks come from a GitHub App installation. Webhook
verification and event handling live in `github/webhooks/`.

## Import rules

```ts
// ✅ From a .server.ts / +server.ts file
import { resolveUserRepositories } from '$lib/server/repositories';

// ❌ From client code — WILL BREAK THE BUILD
import { resolveUserRepositories } from '$lib/server/repositories';
```

## Adding new server code

1. Create `{domain}.ts` (or a `{domain}/` directory) for the service.
2. Add validation schemas and tables in `@tribunal/database` (schemas in `src/validation/`).
3. Add route handlers in `src/routes/` if HTTP access is needed.
4. Write tests in `{domain}.test.ts`.
