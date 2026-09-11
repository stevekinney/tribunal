/**
 * Detects a reimplementation of the MCP rate limiter's Redis logic in Tribunal's
 * own source (TRI-56 AC1).
 *
 * Tribunal supplies only storage and configuration; the limiting — the Lua, the
 * sliding-window arithmetic, the slot identity — lives in `@lostgradient/mcp` and
 * must not be copied here. The distinctive tell of a copy is the sorted-set Redis
 * commands the library's Lua uses: today these tokens appear only inside that
 * library's Lua strings (in `node_modules`, which this scan does not cover), so
 * any appearance in Tribunal's source is a reimplementation.
 *
 * The tokens live inside string literals (they are Lua source), which is exactly
 * what we want to catch — so, unlike the NODE_ENV scanner, this does NOT blank
 * string contents. Matching is case-sensitive and word-bounded: these are Redis
 * command mnemonics, always upper-case in Lua, so a lower-case identifier or a
 * longer word that merely contains one is not flagged.
 *
 * Scope, intentional: this catches the common copy shape — inlined upper-case Lua
 * — and pairs with the `RedisClientType` ban (below) that stops a second raw Redis
 * client from existing at all. It does not attempt to detect a reimplementation
 * built entirely on node-redis's camelCase API (`zAdd`) or through a differently
 * typed abstraction; a general "is this a reimplementation" check is unfalsifiable
 * (TRI-56 AC1 chose these two mechanical proxies for exactly that reason).
 */
const BANNED_LUA_TOKENS = ['ZREMRANGEBYSCORE', 'ZADD', 'ZCARD', 'ZSCORE', 'PEXPIRE'] as const;

const TOKEN_MATCHERS = BANNED_LUA_TOKENS.map(
  (token) => [token, new RegExp(`\\b${token}\\b`)] as const,
);

/**
 * The one file allowed to name node-redis's nominal `RedisClientType` — the
 * single Redis adapter (TRI-49). Everywhere else consumes the narrow
 * `RateLimitRedisClient` alias it exports, so a fresh `RedisClientType` reference
 * elsewhere signals a second adapter / a store reimplementation.
 */
const PERMITTED_REDIS_CLIENT_TYPE_FILE = 'packages/github/src/cache.ts';
const REDIS_CLIENT_TYPE = /\bRedisClientType\b/;

/**
 * Returns `file:line (TOKEN)` for every banned Lua token in `source`, plus a
 * `RedisClientType` reference outside the permitted adapter file. Both are the
 * mechanical enforcement of TRI-56 AC1: Tribunal must not reimplement the
 * library's limiting logic nor open a second raw Redis client.
 */
export function findLimiterReimplementation(source: string, filePath: string): string[] {
  const violations: string[] = [];
  const lines = source.split('\n');
  for (const [lineIndex, line] of lines.entries()) {
    for (const [token, matcher] of TOKEN_MATCHERS) {
      if (matcher.test(line)) {
        violations.push(`${filePath}:${lineIndex + 1} (${token})`);
      }
    }
    if (filePath !== PERMITTED_REDIS_CLIENT_TYPE_FILE && REDIS_CLIENT_TYPE.test(line)) {
      violations.push(`${filePath}:${lineIndex + 1} (RedisClientType)`);
    }
  }
  return violations;
}
