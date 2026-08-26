You are able to use the Svelte MCP server, where you have access to comprehensive Svelte 5 and SvelteKit documentation. Here's how to use the available tools effectively:

## About this repository

Tribunal is an automated code-review service, namespaced `@tribunal/*`. It runs as three deployed applications: `applications/web` (SvelteKit, public UI and webhook receiver), `applications/engine` (Weft workflows, Tensorlake reviewer sandboxes, review posting), and `applications/proxy` (signed egress boundary for sandboxes), plus shared packages under `packages/*`.

Sign-in is Neon Auth with GitHub as the identity provider; repository access is a GitHub App installation. Beyond GitHub, the service depends on Neon Postgres, Redis, Tensorlake, and the Anthropic Claude Agent SDK. Do not treat GitHub as the only integration when scoping work.

See `AGENTS.md` for the canonical description.

Use Bun for all dependency installs and scripts (e.g., `bun install`, `bun run …`); avoid npm/pnpm/yarn.
Primary project rules live in `.claude/rules/**` and remain the source of truth.
No Tailwind; use design tokens from `@tribunal/components/styles` (defined in `packages/components/src/styles/tokens.css`) and scoped styles.
Workflow guidance lives in `.claude/skills/**`; invoke `/skill-name` when a task matches a skill.

## Naming preferences (no short names)

Be explicit. Avoid abbreviations in prose, identifiers, and filenames when reasonable.

- Use `configuration`, not `config`.
- Use `utilities`, not `utils`.
- Use `repository`, not `repo`.
- Use `pull request`, not `pr`.

## No legacy or compatibility code

Do not add legacy/backwards-compatibility/migration code. Prefer deleting duplication and updating call sites directly. Do not introduce new files or re-exports just to keep old APIs alive.

## Available MCP Tools:

### 1. list-sections

Use this FIRST to discover all available documentation sections. Returns a structured list with titles, use_cases, and paths.
When asked about Svelte or SvelteKit topics, ALWAYS use this tool at the start of the chat to find relevant sections.

### 2. get-documentation

Retrieves full documentation content for specific sections. Accepts single or multiple sections.
After calling the list-sections tool, you MUST analyze the returned documentation sections (especially the use_cases field) and then use the get-documentation tool to fetch ALL documentation sections that are relevant for the user's task.

### 3. svelte-autofixer

Analyzes Svelte code and returns issues and suggestions.
You MUST use this tool whenever writing Svelte code before sending it to the user. Keep calling it until no issues or suggestions are returned.

### 4. playground-link

Generates a Svelte Playground link with the provided code.
After completing the code, ask the user if they want a playground link. Only call this tool after user confirmation and NEVER if code was written to files in their project.
