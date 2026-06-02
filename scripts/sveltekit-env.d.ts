/**
 * Ambient type declarations for SvelteKit virtual modules.
 *
 * Scripts that transitively import SvelteKit app code (e.g., service-key-crypto →
 * encryption → $env/dynamic/private) need these stubs so tsc can resolve the
 * virtual module paths. At runtime, Bun handles this via SvelteKit's resolver.
 */
declare module '$env/dynamic/private' {
  export const env: Record<string, string | undefined>;
}

declare module '$env/dynamic/public' {
  export const env: Record<string, string | undefined>;
}

declare module '$env/static/private' {
  const value: Record<string, string>;
  export default value;
}

declare module '$env/static/public' {
  const value: Record<string, string>;
  export default value;
}
