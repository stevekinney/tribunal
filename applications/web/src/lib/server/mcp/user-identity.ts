import type { McpContext } from '@lostgradient/mcp';

/**
 * The engine hands handlers an opaque `userId: string`, because the OAuth
 * layer's subject identifier is a string at the interface for every host.
 * Tribunal's `user.id` is `integer(...).generatedAlwaysAsIdentity()`, so every
 * handler has to convert before it can query anything.
 *
 * The conversion is strict rather than `Number(...)`: that coerces `''` to
 * `0`, `' 7 '` to `7`, and `'0x10'` to `16`, so a malformed subject would
 * silently become a real user's identifier instead of failing. A subject that
 * does not match Tribunal's identity column exactly is refused, and the caller
 * gets a tool error rather than another user's rows.
 */
export function resolveTribunalUserId(context: Pick<McpContext, 'userId'>): number | null {
  if (!/^[1-9][0-9]*$/.test(context.userId)) return null;
  const userId = Number(context.userId);
  return Number.isSafeInteger(userId) ? userId : null;
}
