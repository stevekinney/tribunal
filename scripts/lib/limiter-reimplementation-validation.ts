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
 * string contents. Matching is CASE-INSENSITIVE: Redis command names are
 * case-insensitive, so a copy could spell `redis.call('zadd', ...)` in lowercase
 * and still run — and the same matcher catches node-redis's camelCase method
 * spelling (`zAdd`). It stays word-bounded, so a longer identifier that merely
 * contains a token (`myZaddHelper`) is not flagged. `ZREM` is deliberately absent
 * from the list because the shared-client proxy legitimately forwards `zRem`; the
 * five below are used only by the library's Lua, so any spelling of them in
 * Tribunal's source is a reimplementation. Pairs with the `RedisClientType` ban
 * (below), which stops a second raw Redis client from existing at all.
 */
const BANNED_LUA_TOKENS = ['ZREMRANGEBYSCORE', 'ZADD', 'ZCARD', 'ZSCORE', 'PEXPIRE'] as const;

const TOKEN_MATCHERS = BANNED_LUA_TOKENS.map(
  (token) => [token, new RegExp(`\\b${token}\\b`, 'i')] as const,
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
