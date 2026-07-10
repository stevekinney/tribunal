import { describe, expect, it } from 'vitest';
import { resolveHasNextPage } from './shared.js';

describe('resolveHasNextPage', () => {
  it('returns true when the Link header has a next relation', () => {
    expect.assertions(1);
    const linkHeader = '<https://api.github.com/resource?page=2>; rel="next"';
    expect(resolveHasNextPage(linkHeader)).toBe(true);
  });

  it('returns false when the Link header has only a prev relation', () => {
    expect.assertions(1);
    const linkHeader = '<https://api.github.com/resource?page=1>; rel="prev"';
    expect(resolveHasNextPage(linkHeader)).toBe(false);
  });

  it('returns false when the Link header is missing, even on a full page', () => {
    expect.assertions(1);
    // GitHub omits the Link header entirely when the current page is the
    // last one, including when it happens to contain exactly `perPage` rows.
    // A row-count fallback would misreport `hasNextPage: true` here.
    expect(resolveHasNextPage(undefined)).toBe(false);
  });
});
