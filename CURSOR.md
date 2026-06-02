Cursor-specific guidance for Tribunal. The detailed rules live in `.cursor/rules/README.md`, and `.claude/rules/**` is the source of truth (Cursor mirrors those rules by file path). If guidance conflicts, `.claude/rules/**` wins.

Quick defaults:

- Use Bun for installs and scripts (`bun install`, `bun run ...`). The lockfile is `bun.lock`; never use `npm`, `yarn`, or `pnpm`.
- No Tailwind. Style with scoped `<style>` blocks and the design tokens (`--space-*`, `--text-*`, `--surface-*`, etc.) from `@tribunal/components/styles` — the underlying token file is `packages/components/src/styles/tokens.css`.
- Follow Svelte 5 runes patterns (`.claude/rules/svelte-patterns.md`) and SvelteKit route conventions (`.claude/rules/svelte-routes.md`).
- The web app lives in `applications/web`; shared code lives in `@tribunal/*` packages under `packages/`.
