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

  it('is case-sensitive and word-bounded (lower-case or embedded spellings are not flagged)', () => {
    // Redis command mnemonics are upper-case in Lua; a lower-case identifier or a
    // longer word that merely contains one must not trip the scan.
    expect(findLimiterReimplementation('const zadd = 1; const myZADDHelper = 2;', 'x.ts')).toEqual(
      [],
    );
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
