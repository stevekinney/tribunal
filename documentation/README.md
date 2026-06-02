# Documentation index

Tribunal is a SvelteKit web app whose only integration is GitHub: log in with GitHub,
install the Tribunal GitHub App, and browse the open pull requests for the repositories
the install grants access to. The data model is deliberately flat
(`user → github_installation → installation_repository → repository → pull_request`).
There are no background workers, workflow engine, or other integrations.

## Start here

- [Project README](../README.md) - Overview, setup, scripts
- [GETTING_STARTED.md](GETTING_STARTED.md) - First-time setup guide
- [ARCHITECTURE.md](ARCHITECTURE.md) - System overview and diagrams
- [TESTING.md](TESTING.md) - Test strategy and patterns
- [TROUBLESHOOTING.md](TROUBLESHOOTING.md) - Common issues and solutions
- [AGENTS.md](../AGENTS.md) - Shared coding and verification rules for all agents
- [CLAUDE.md](../CLAUDE.md) - Claude Code rules and workflow expectations

## The GitHub flow

- [INTEGRATIONS.md](INTEGRATIONS.md) - GitHub OAuth login, App installation, and webhooks (the only integration)
- [WORKFLOWS.md](WORKFLOWS.md) - The end-to-end user flow and webhook processing

## Development guides

- [check-matrix.md](check-matrix.md) - Check inventory and CI/hook policy

## Technical reference

- [DATABASE.md](DATABASE.md) - Schema guide, migration workflow, and CI validation
- [database/migration-workflow.md](database/migration-workflow.md) - Migration generation and apply workflow
- [API.md](API.md) - HTTP API reference (the API-key check and GitHub webhook routes)
- [api/observability-envelope.md](api/observability-envelope.md) - Correlation and request ID propagation
- [api-keys-authorization.md](api-keys-authorization.md) - Customer API key authorization policy
- [PLATFORM_ADMIN_RUNBOOK.md](PLATFORM_ADMIN_RUNBOOK.md) - Platform administrator access procedures

## Framework guides

- [svelte-best-practices.md](svelte-best-practices.md) - Svelte 5 patterns

## Testing reference

- [testing/route-behavior-checklist.md](testing/route-behavior-checklist.md) - Route behavior checklist
- [testing/runtime-parity-checklist.md](testing/runtime-parity-checklist.md) - Runtime parity checklist
- [testing/ui-regression-matrix.md](testing/ui-regression-matrix.md) - UI regression permutation matrix

## Internal tooling and AI configs

- [GEMINI.md](../GEMINI.md) - Gemini prompt guidance
- [CURSOR.md](../CURSOR.md) - Cursor rules
- [copilot-instructions.md](../.github/copilot-instructions.md) - GitHub Copilot guidance
- [.claude/](../.claude/) - Claude rules, commands, skills
- [.codex/](../.codex/) - Codex agents, playbooks, skills

## Component and subsystem READMEs

- [applications/web/src/lib/README.md](../applications/web/src/lib/README.md)
- [applications/web/src/lib/server/README.md](../applications/web/src/lib/server/README.md)
- [applications/web/src/lib/server/database/README.md](../applications/web/src/lib/server/database/README.md)
- [applications/web/src/lib/server/github/README.md](../applications/web/src/lib/server/github/README.md)
- [applications/web/src/routes/README.md](../applications/web/src/routes/README.md)
- [applications/web/test/README.md](../applications/web/test/README.md)

## Contributing to docs

- Keep guides focused and actionable
- Include code examples
- Update this index when adding new docs
- Link only to files that exist; remove entries when their target is deleted
