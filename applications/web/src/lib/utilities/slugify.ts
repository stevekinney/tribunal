/**
 * Slugify a string for use in URLs and identifiers.
 *
 * Converts to lowercase, replaces non-alphanumeric characters with hyphens,
 * collapses multiple hyphens, and trims leading/trailing hyphens.
 */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}
