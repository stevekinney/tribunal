---
paths:
  - src/hooks.*
---

# Hooks patterns

- **Handle flow**: `handle` should normally return `resolve(event)`. If you
  short-circuit with a custom `Response`, `event.cookies` mutations are not
  applied. Set `Set-Cookie` manually (see `src/hooks.server.ts`).
- **Prerender awareness**: `handle` runs during prerender. Gate build-only
  logic with `import { building } from '$app/environment'` if needed.
- **Immutable responses**: responses like `Response.redirect()` can have
  immutable headers. Clone before mutating headers.
- **Multiple handles**: compose multiple `handle` functions with
  `sequence` from `@sveltejs/kit/hooks`.
- **handleFetch**: use for SSR request rewrites or manual cookie forwarding
  to sibling subdomains.
- **handleError**: log and return safe error payloads; never throw. Server and
  client hooks have different event types.
- **init**: keep lightweight, especially on the client (delays hydration).
- **handleValidationError**: only relevant when remote functions are enabled;
  keep responses generic.
- **reroute/transport**: keep `reroute` pure and idempotent; only add
  `transport` for explicit custom serialization needs.
