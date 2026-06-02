/**
 * Stub for $app/paths used in tests.
 * Tests that need specific behavior should use vi.mock('$app/paths', ...).
 */
export const base = '';
export const assets = '';
export function resolve(path: string, ...rest: string[]): string {
  return [path, ...rest].join('/');
}
