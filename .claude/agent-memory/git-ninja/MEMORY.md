# Git Ninja Memory — tribunal repository

## Repository conventions

- **GitHub repository**: `tribunal/tribunal`
- **Main branch**: `main`
- **Branch naming**: `claude/<name>` for AI agent branches, `feature/TEAM-NNN-description` for ticket branches
- **Commit subject format**: `TEAM-NNN: Imperative summary` when a ticket exists; plain imperative summary otherwise

## Workflow notes

- After rebase, always push with `--force-with-lease` (history rewritten)
- Turbo caches check results; a cache miss in `@tribunal/web:check` may replay warnings from before a fix was committed — confirm against the `@tribunal/components:check` output which is more targeted
- `bun run check` runs `turbo run check` across all workspace packages; a single warning in one package does not block the overall run

## Check command

```
bun run check
```

Runs svelte-check + tsc across all workspace packages via turbo. Zero errors required before opening a pull request.

## Pull request creation

Use `gh pr create`. No ticket → use a descriptive imperative title. With ticket → prefix title with `TEAM-NNN:`.

## Drizzle ORM patterns

- Use `inArray(column, ids)` instead of raw ``sql`column = ANY(${ids})``` when passing JS arrays. `inArray` generates `IN (?, ?, ...)` which works with pglite (E2E), Neon HTTP, and Postgres equally. Raw `ANY($1)` with array params breaks pglite.
- When mocking Drizzle's `db.select().from().where().orderBy()` chain in Vitest, `.where()` must return a chainable thenable — not a bare Promise. Pattern: `where: vi.fn(() => ({ orderBy: mockFn, then: (resolve, reject) => Promise.resolve([]).then(resolve, reject) }))`. `vi.resetAllMocks()` clears implementations; re-establish `mockFn.mockResolvedValue([])` inside `beforeEach`.

## SvelteKit form error scoping

- SvelteKit's `form` prop is global per page. When multiple actions share field names (e.g., `name`, `errors`), use a discriminator field present only in one action to scope errors to the form that produced them.
