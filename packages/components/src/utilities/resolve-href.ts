import { resolve } from '$app/paths';
import type { Pathname } from '$app/types';

/**
 * Wrapper around SvelteKit's resolve function that accepts dynamic string hrefs.
 * Use this when the href is a dynamic value rather than a literal route string.
 */
export function resolveHref(href: Pathname | (string & {})): string {
  // Cast through `any`: this wrapper accepts arbitrary dynamic strings, while
  // SvelteKit's `resolve` is typed for known routes plus their params.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (resolve as any)(href);
}
