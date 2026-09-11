import { describe, expect, it } from 'vitest';
import { findLimiterReimplementation } from './limiter-reimplementation-validation';

describe('findLimiterReimplementation', () => {
  it('flags a banned Lua token inside a string literal with a file, line, and token (AC1)', () => {
    // The token lives in a Lua string — exactly the reimplementation this catches.
    const source = [
      'const first = 1;',
      'await redis.eval("redis.call(\'ZADD\', KEYS[1])");',
      '',
    ].join('\n');
    const violations = findLimiterReimplementation(source, 'applications/web/src/example.ts');
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('applications/web/src/example.ts:2');
    expect(violations[0]).toContain('ZADD');
  });

  it('flags each of the banned sorted-set commands', () => {
    for (const token of ['ZREMRANGEBYSCORE', 'ZADD', 'ZCARD', 'ZSCORE', 'PEXPIRE']) {
      expect(findLimiterReimplementation(`call('${token}', k)`, 't.ts')).toHaveLength(1);
    }
  });

  it('reports every occurrence across lines', () => {
    const source = ["redis.call('ZADD', k)", "redis.call('ZCARD', k)"].join('\n');
    const violations = findLimiterReimplementation(source, 'multi.ts');
    expect(violations).toHaveLength(2);
    expect(violations[0]).toContain(':1 (ZADD)');
    expect(violations[1]).toContain(':2 (ZCARD)');
  });

  it('does not flag ordinary source without the tokens', () => {
    const source =
      'const store = createRedisSlidingWindowStore(client);\nawait store.consume(input);';
    expect(findLimiterReimplementation(source, 'clean.ts')).toEqual([]);
  });

  it('flags a lower-case Lua spelling (Redis command names are case-insensitive)', () => {
    // `redis.call('zadd', ...)` runs identically to ZADD, so a case-sensitive scan
    // would let a lower-case copy through — this is the blind spot the scan closes.
    expect(findLimiterReimplementation("redis.call('zadd', k)", 'lower.ts')).toHaveLength(1);
  });

  it("flags node-redis's camelCase method spelling", () => {
    expect(findLimiterReimplementation('await client.zAdd(key, member)', 'camel.ts')).toHaveLength(
      1,
    );
  });

  it('stays word-bounded: a longer identifier merely containing a token is not flagged', () => {
    expect(
      findLimiterReimplementation('const myZaddHelper = 2; const zremover = 3;', 'x.ts'),
    ).toEqual([]);
  });

  it('flags a RedisClientType reference outside the permitted adapter file', () => {
    const source = "import type { RedisClientType } from 'redis';";
    const violations = findLimiterReimplementation(source, 'applications/web/src/other.ts');
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('RedisClientType');
  });

  it('permits RedisClientType in the single adapter file (packages/github/src/cache.ts)', () => {
    const source = "import type { RedisClientType } from 'redis';";
    expect(findLimiterReimplementation(source, 'packages/github/src/cache.ts')).toEqual([]);
  });
});
