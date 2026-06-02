---
name: github-integration-rules
description: Apply GitHub integration domain rules for webhooks, API patterns, OAuth integrations, and CI workflow safety.
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
  - Edit
  - Write
---

# GitHub Integration Rules

## When to use

- Building/modifying GitHub webhook handlers
- Working with GitHub API calls in services
- Implementing OAuth integration flows tied to GitHub
- Updating GitHub Actions workflows that gate automation or reviews
- Handling installation lifecycle events and repository membership changes

## Constraints

- Follow `{baseDir}/rules/webhooks.md`
- Follow `{baseDir}/rules/github-api.md`
- Follow `{baseDir}/rules/github-actions.md`
- Follow `{baseDir}/rules/oauth-integrations.md`

## Key patterns

- Same-repo operations only; fail fast for unsupported fork scenarios.
- Deterministic workflow identifiers and idempotent webhook handling.
- Append-only bot comments; no editing historical automation comments.
- CI gating must treat pending as pending (not failure) while polling checks.
- Classify GitHub 403 with rate-limit headers as retryable, otherwise permission failure.
- Validate branch/base ref inputs before git or API operations.
- Use least-privilege workflow permissions and OIDC settings in actions.
- Keep workflow shell scripts injection-safe when interpolating GitHub event data (use env vars or `toJson`).
- Preserve OAuth integration status semantics and token validation reason mapping.

## Workflow

1. Identify whether the change is webhook, API, OAuth, CI workflow, or lifecycle logic.
2. Apply the corresponding rules and validate idempotency/authorization behavior.
3. Ensure retry/backoff and rate-limit handling are explicit.

## Verification

- Relevant checks pass for touched code paths (for example `bun run check`).
- Webhook/API/OAuth behavior has explicit error classification and fallback handling.
- CI workflow changes preserve least privilege and trigger safety.

## Additional references

- [GitHub Domain Reference](references/github-domain-reference.md)
- [GitHub API Reference](references/github-api-reference.md)
- [OAuth Integration Reference](references/oauth-integration-reference.md)
