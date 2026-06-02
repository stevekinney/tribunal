/**
 * Ambient type declarations for SvelteKit modules that are referenced
 * transitively when svelte-check follows $lib/* path aliases into the
 * web app's server code.
 *
 * These declarations allow standalone type-checking of the components
 * package. The real $env modules are provided by SvelteKit at build time.
 */

declare module '$env/dynamic/private' {
  export const env: Record<string, string | undefined>;
}

declare module '$env/static/private' {
  const env: Record<string, string>;
  export default env;
}
