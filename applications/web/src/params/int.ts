/**
 * Integer matcher for numeric params.
 */
export function match(param: string): boolean {
  return /^\d+$/.test(param);
}
