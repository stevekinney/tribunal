# Getting Started

This guide gets you from clone to a running local app. For system context, see
[ARCHITECTURE.md](./ARCHITECTURE.md).

Tribunal is a SvelteKit web application (`applications/web`) backed by shared
packages (`packages/*`). Neon Auth owns identity and sessions, with GitHub as the
only sign-in provider. Tribunal separately stores an encrypted GitHub OAuth
connection for repository authorization, then binds GitHub App installations to
the signed-in Tribunal user.

## Prerequisites

- Bun v1.x (install: https://bun.sh/docs/installation)
- PostgreSQL 14+ (local) or a Neon account for hosted Postgres
- Node 22+

## First-time setup

Clone the repository and change into it:

```sh
git clone <repository-url> tribunal
cd tribunal
```

Create your local environment file:

```sh
cp .env.example .env
```

> [!TIP]
> You're probably better off pulling down the environment variables from Vercel.
> Install the Vercel CLI (`bun install -g vercel`), run `vercel link` to link it up with the project on Vercel, and then run `vercel env pull`.

Alternatively, fill in the required environment variables in `.env`:

| Variable               | Description                                    | Notes                                |
| ---------------------- | ---------------------------------------------- | ------------------------------------ |
| `DATABASE_URL`         | PostgreSQL connection string                   | Neon or local Postgres               |
| `ENCRYPTION_KEY`       | 32-byte (64 hex char) key for token encryption | Generate with `openssl rand -hex 32` |
| `PUBLIC_NEON_AUTH_URL` | Browser-facing Neon Auth URL                   | Managed Neon Auth service URL        |
| `NEON_AUTH_BASE_URL`   | Server-facing Neon Auth base URL               | Used for JWT issuer, audience, JWKS  |

Configure Neon Auth outside this repository:

- Enable Neon Auth on the database branch.
- Configure GitHub OAuth in Neon Auth.
- Set the GitHub OAuth callback URL to `{NEON_AUTH_BASE_URL}/callback/github`.
- Add trusted domains for `http://localhost:5173` and production.

GitHub OAuth in Tribunal is not login identity. It is the app-owned repository
authorization connection stored in `oauth_connection`. The GitHub App is what
grants installation access and delivers webhooks. The variables below configure
those GitHub surfaces:

| Variable                    | Description                   | Notes                                                                      |
| --------------------------- | ----------------------------- | -------------------------------------------------------------------------- |
| `GITHUB_CLIENT_ID`          | GitHub OAuth client ID        | App-owned repository access connection                                     |
| `GITHUB_CLIENT_SECRET`      | GitHub OAuth client secret    | App-owned repository access connection                                     |
| `GITHUB_REDIRECT_URI`       | GitHub OAuth redirect URI     | Defaults to `http://localhost:5173/connect/github/account/callback` in dev |
| `GITHUB_APP_NAME`           | GitHub App name               | Repository access                                                          |
| `GITHUB_APP_ID`             | GitHub App ID                 | Repository access                                                          |
| `GITHUB_APP_PRIVATE_KEY`    | GitHub App private key (PEM)  | Signs installation token requests                                          |
| `GITHUB_APP_WEBHOOK_SECRET` | GitHub App webhook secret     | Verifies incoming webhook signatures                                       |
| `VITE_PORT`                 | Vite dev server port override | Optional                                                                   |
| `VITE_PREVIEW_PORT`         | Vite preview port override    | Optional                                                                   |
| `SB_PORT`                   | Storybook port override       | Optional                                                                   |
| `PW_PORT`                   | Playwright port override      | Optional                                                                   |
| `SB_BASE_URL`               | Storybook base URL override   | Optional                                                                   |
| `PW_BASE_URL`               | Playwright base URL override  | Optional                                                                   |

Install all dependencies (Bun workspaces handles every package automatically):

```sh
bun install
```

Create a local database (if using local Postgres):

```sh
createdb tribunal
```

Then set `DATABASE_URL` in `.env`, for example:

```sh
DATABASE_URL=postgres://user:password@localhost:5432/tribunal
```

> [!WARNING]
> You should probably just use the hosted Neon database.

Apply the schema to your database:

```sh
bun run db:migrate
```

> [!NOTE]
> `db:migrate` applies the full migration history, which is the correct way to
> set up a fresh database.

Start the SvelteKit dev server:

```sh
bun run dev
```

## Git hooks and local validation

Git hooks are configured via Lefthook and run automatically on commit and push.

**Default behavior (fast):** Hooks only run checks that have no CI equivalent:

- **Pre-commit**: `lint-staged` (format + lint staged files), migration consistency (if schema files changed), doc/skill sync (if docs changed), documentation drift (if docs changed).
- **Pre-push**: Playwright tests (if relevant files changed).

**Full local checks (`HOOKS_STRICT=1`):** To also run CI-duplicated checks (lockfile sync, import boundaries, unit tests, type check, build) during commit/push:

```sh
HOOKS_STRICT=1 git commit -m "my changes"
HOOKS_STRICT=1 git push
```

**On-demand full validation (`bun run verify`):** Runs all CI checks plus hook-only gates (migration consistency), sequentially, with a pass/fail summary. Use this before pushing when you want full confidence without waiting for CI:

```sh
bun run verify
```
