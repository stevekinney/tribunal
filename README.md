# Tribunal

Tribunal is a GitHub-focused pull request triage app. You sign in with GitHub, install the Tribunal GitHub App on the repositories you care about, and Tribunal gives you a single place to see your connected repositories and their open pull requests.

It listens to GitHub webhooks to keep pull request state current — reviews, CI signals, and lifecycle events — so the list of what needs attention stays accurate without you bouncing between tabs.

## Key Features

- GitHub OAuth login for identity
- GitHub App installation for repository access and webhooks
- Repository list and open pull request views
- Webhook ingestion with signature verification, delivery claiming, and typed event routing
- Typed data layer with Drizzle ORM on Neon PostgreSQL

## Quick Start

```sh
bun install
cp .env.example .env  # Configure required vars
bun run dev
```

Open http://localhost:5173 after the dev server starts.

## Start here

- [Documentation index](documentation/README.md) - Canonical doc map
- [CLAUDE.md](CLAUDE.md) - Claude Code rules and workflow expectations
- [GEMINI.md](GEMINI.md) - Gemini prompt guidance
- [copilot-instructions.md](.github/copilot-instructions.md) - GitHub Copilot guidance

## Documentation

- [Documentation index](documentation/README.md) - Start here for guides and references
- [Getting Started](documentation/GETTING_STARTED.md)
- [Architecture](documentation/ARCHITECTURE.md)
- [Testing](documentation/TESTING.md)
- [Troubleshooting](documentation/TROUBLESHOOTING.md)
- [Database](documentation/DATABASE.md)
- [API Reference](documentation/API.md)
- [Svelte Best Practices](documentation/svelte-best-practices.md)

## Key Scripts

| Command                                   | Description                     |
| ----------------------------------------- | ------------------------------- |
| `bun run dev`                             | Start all dev servers via Turbo |
| `bun run check`                           | Run SvelteKit sync + typechecks |
| `bun run test`                            | Run all unit tests via Turbo    |
| `bun run --cwd applications/web test:e2e` | Run Playwright E2E tests        |
| `bun run db:generate`                     | Generate Drizzle migration SQL  |
| `bun run db:migrate`                      | Apply Drizzle migrations        |
| `bun run db:check`                        | Verify migration consistency    |
| `bun run scripts/doctor.ts`               | Validate local setup            |

## Tech Stack

- SvelteKit + Svelte 5
- Drizzle ORM + Neon PostgreSQL
- Bun, Vite, Vitest, Playwright

## Codex MCP (Optional)

The `.codex/mcp.json` configures the Codex MCP server for AI-assisted development.
This requires the `codex` binary in your PATH. If unavailable, MCP features are
disabled automatically — the application functions normally without it.

## Contributing

See [CLAUDE.md](CLAUDE.md) for workflow and tooling expectations.

## Development Notes

Once you've installed dependencies with `bun install`, start a development server:

```sh
bun run dev

# or start the server and open the app in a new browser tab
bun run dev -- --open
```

## Git hooks

Git hooks are managed by Lefthook (`bun run prepare` installs them). The pre-commit hook runs `lint-staged` and runs `bun run check` and `bun run test` only when staged files include JavaScript, TypeScript, or Svelte extensions. Pre-push runs Playwright/build only when relevant, and skips the standalone build when E2E already ran.

## Building

To create a production version of your app:

```sh
bun run build
```

You can preview the production build with `bun --cwd applications/web run preview`.

> To deploy your app, you may need to install an [adapter](https://svelte.dev/docs/kit/adapters) for your target environment.

## Scripts

Root package.json scripts (turbo-orchestrated):

- `bun run dev`: Start all dev servers via Turbo.
- `bun run build`: Build all packages via Turbo.
- `bun run check`: Type-check all packages via Turbo.
- `bun run lint`: Lint all packages via Turbo.
- `bun run test`: Run all unit tests via Turbo.
- `bun run format` / `bun run format:check`: Prettier write / check.
- `bun run db:generate`: Generate migration SQL from schema changes.
- `bun run db:migrate`: Apply pending migrations.
- `bun run db:check`: Verify schema and migrations are in sync.
- `bun run db:studio`: Drizzle Studio.
- `bun run verify`: Run all CI checks locally with pass/fail summary.

Scripts in `./scripts` (run with `bun run scripts/<file>`):

- `doctor.ts`: Environment sanity checks.
- `lib/`: Shared script utilities (not directly runnable).
