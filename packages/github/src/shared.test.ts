import { describe, expect, it } from 'vitest';
import { resolveHasNextPage } from './shared.js';

describe('resolveHasNextPage', () => {
  it('returns true when the Link header has a next relation', () => {
    expect.assertions(1);
    const linkHeader = '<https://api.github.com/resource?page=2>; rel="next"';
    expect(resolveHasNextPage(linkHeader, 0, 30)).toBe(true);
  });

  it('returns false when the Link header has only a prev relation', () => {
    expect.assertions(1);
    const linkHeader = '<https://api.github.com/resource?page=1>; rel="prev"';
    expect(resolveHasNextPage(linkHeader, 10, 30)).toBe(false);
  });

  it('falls back to a full-page row-count heuristic when the Link header is missing', () => {
    expect.assertions(2);
    expect(resolveHasNextPage(undefined, 30, 30)).toBe(true);
    expect(resolveHasNextPage(undefined, 29, 30)).toBe(false);
  });
});
