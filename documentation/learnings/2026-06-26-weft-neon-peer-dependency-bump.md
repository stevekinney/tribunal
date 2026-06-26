# Learnings: weft peer dependency bump (2026-06-26)

- When bumping `@lostgradient/weft`, always check its declared (optional) peer dependencies and update matching workspace dependencies to a compatible version. `weft@0.8.0` requires `@neondatabase/serverless ^1.1.0`; all workspaces that depend on weft's Neon integration must match.
- Three workspaces currently depend on `@lostgradient/weft`: `applications/engine`, `applications/web`, and `packages/github`. Review all three when upgrading.
- After bumping peer dependencies, re-run `bun install` to regenerate `bun.lock` with the updated resolution and integrity hash.
