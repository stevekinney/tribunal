# src/lib

Shared UI, domain, and infrastructure modules for the Tribunal web app.
Tribunal is intentionally minimal: log in with GitHub, install the GitHub
App in your organizations, and browse open pull requests for the
repositories you can access.

## Directory Overview

| Directory     | Purpose                                                                            | Import Pattern                                                                |
| ------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `components/` | App-specific Svelte components (the design system lives in `@tribunal/components`) | `import CodeEditor from '$lib/components/CodeEditor.svelte'`                  |
| `constants/`  | Shared constants (authorization providers, API scopes)                             | `import { AUTH_PROVIDER_LIST } from '$lib/constants/authorization-providers'` |
| `server/`     | Server-only domain logic (database, auth, GitHub integration, rate limiting)       | Only from `.server.ts` / `+page.server.ts` / `+server.ts`                     |
| `test-utils/` | Test helpers (e.g. request-event builders)                                         | `import { ... } from '$lib/test-utils/request-event'`                         |
| `utilities/`  | General utilities, form validation, and Svelte rune helpers                        | `import { slugify } from '$lib/utilities'`                                    |

## Import Boundaries

- `server/` is server-only. Only import it from server modules and routes.
- `utilities/` is exported through its barrel at `src/lib/utilities/index.ts`;
  some entries re-export from `@tribunal/components`.

## Key Files

- `index.ts` - `$lib` barrel placeholder.

## Shared Packages

Code shared beyond the web app lives in the workspace packages, not here:

- `@tribunal/database` (`packages/database/`) - Drizzle schema, queries, and Zod validation schemas (`src/validation/`).
- `@tribunal/test` (`packages/test/`) - test database and fixtures.
- `@tribunal/components` (`packages/components/`) - the design system.

## Related Rules

- Component standards: [`.claude/rules/component-library.md`](../../../../.claude/rules/component-library.md)
- Markdown pipeline: [`.claude/rules/markdown.md`](../../../../.claude/rules/markdown.md)
- Svelte patterns: [`.claude/rules/svelte-patterns.md`](../../../../.claude/rules/svelte-patterns.md)
- Testing patterns: [`.claude/rules/testing.md`](../../../../.claude/rules/testing.md)
