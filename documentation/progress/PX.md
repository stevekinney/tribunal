# PX Credential Proxy

Status: complete

## Done

- Implemented signed per-run capability tokens with expiration and permission checks.
- Added GitHub and Anthropic proxy routing with credential injection.
- Enforced host allowlists and blocked disallowed destinations.
- Added redacted request audit logging.
- Added tests for missing, invalid, and expired tokens, scope enforcement, credential injection, blocked destinations, and redaction.
- Ran `bun run --cwd applications/proxy test:coverage`; it passed with 100 percent line and function coverage.

## Left

- None for this track.

## Failures

- None.

<promise>TRACK_PX_DONE</promise>
