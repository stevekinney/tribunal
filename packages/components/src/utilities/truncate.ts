/**
 * Truncate a string to a maximum length, adding a suffix if truncated.
 *
 * @param text - The string to truncate
 * @param maxLength - Maximum length before truncation
 * @param suffix - Suffix to add when truncated (default: '...')
 * @returns Truncated string with suffix, or original if within limit
 *
 * @example
 * truncate('Hello World', 5) // 'Hello...'
 * truncate('Hi', 5) // 'Hi'
 * truncate('Hello World', 5, '…') // 'Hello…'
 */
export function truncate(text: string, maxLength: number, suffix = '...'): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength).trim() + suffix;
}
