# GitHub Domain Reference

This reference consolidates guidance from prior integration micro-skills into
the canonical `github-integration-rules` domain pack.

## Webhooks

- Verify signatures and dedupe deliveries before side effects.
- Keep retry strategy explicit for transient API failures.

## API design and caching

- Use consistent cache policy and invalidation strategy for read endpoints.
- Handle pagination/rate-limit behavior explicitly.
- Use typed response normalization and fail-safe error mapping.

## OAuth and integration state

- Keep token storage encrypted and state parameter handling provider-safe.
- Validate status reasons and surface user-safe messaging.
- Preserve workspace ownership boundaries and avoid IDOR-style mutations.

## CI workflow safety

- Use least-privilege permission sets.
- Configure OIDC only where required.
- Guard mention-trigger workflows by author association and concurrency controls.
