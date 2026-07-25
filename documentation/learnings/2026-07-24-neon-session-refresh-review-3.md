# Neon Auth Session-Refresh Review Fixes, Third Re-check Pass (PR #213)

- Fixing a "dead code" review finding (a page/handler that's never actually
  reached) requires tracing the real trigger, not just adding the missing
  logic to the unreachable file. Making the trigger reachable (e.g. turning a
  submit-button-with-form-attribute into a link) can silently trade one
  correctness property (the fix now runs) for another (a native
  `<form>` POST's no-JS reliability for a destructive action like sign-out).
  Check whether the original pattern existed for a reason (progressive
  enhancement) before replacing it.
- SvelteKit's `use:enhance` submit callback is genuinely awaited before the
  underlying `fetch` fires (confirmed by reading
  `@sveltejs/kit/src/runtime/app/forms.js`: `await submit({...})` happens
  before the POST is dispatched). This makes it the correct place to run
  client-only pre-submission side effects (a cross-tab broadcast, ending a
  third-party auth session) for a form whose actual state change must also
  work without JavaScript -- the form still degrades to a native POST if
  `use:enhance` never attaches, since it doesn't change the form's own
  method/action.
- When a `document.addEventListener` is used to detect "the user is still
  active" for a cost-control idle timeout, `scroll` events don't bubble from
  inner `overflow`-scrolling elements -- register that listener with
  `{ capture: true }` (matching on removal too) or an activity-tracking
  interval will falsely mark a genuinely active user idle.
- A test file that fully mocks a shared module (`vi.mock('$lib/x', () => ({
... }))`) must be updated whenever a _sibling_ component reachable from the
  same render tree starts importing a new export from that module --
  otherwise the import resolves to `undefined` and throws only at runtime
  import-time, not at type-check time (confirmed via `authenticated-layout.svelte.test.ts`
  breaking when `user-menu.svelte`, rendered inside the tested layout, started
  importing `broadcastNeonSessionLogout`).
- Removing a page whose only trigger was a link/form now bypassed elsewhere:
  grep the whole source tree (and end-to-end/documentation) for the route
  path first, don't just check for imports of the component file itself --
  the reference that matters is the _URL string_, not a module specifier.
