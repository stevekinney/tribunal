import { describe, expect, it } from 'vitest';
import { encodeFilterValue, resolveHasNextPage, transformAuthor } from './shared.js';

describe('transformAuthor', () => {
  it('returns null for a null or undefined user', () => {
    expect.assertions(2);
    expect(transformAuthor(null)).toBeNull();
    expect(transformAuthor(undefined)).toBeNull();
  });

  it('maps login, avatar_url, and html_url to the normalized shape', () => {
    expect.assertions(1);
    const author = transformAuthor({
      login: 'octocat',
      avatar_url: 'https://example.com/avatar.png',
      html_url: 'https://github.com/octocat',
    });
    expect(author).toEqual({
      login: 'octocat',
      avatarUrl: 'https://example.com/avatar.png',
      htmlUrl: 'https://github.com/octocat',
    });
  });

  it('defaults avatarUrl to null when avatar_url is missing', () => {
    expect.assertions(1);
    const author = transformAuthor({ login: 'octocat', html_url: 'https://github.com/octocat' });
    expect(author?.avatarUrl).toBeNull();
  });
});

describe('encodeFilterValue', () => {
  it('escapes percent signs first to avoid double-encoding', () => {
    expect.assertions(1);
    expect(encodeFilterValue('100%')).toBe('100%25');
  });

  it('escapes pipe and colon delimiters', () => {
    expect.assertions(1);
    expect(encodeFilterValue('a|b:c')).toBe('a%7cb%3ac');
  });

  it('leaves values without special characters unchanged', () => {
    expect.assertions(1);
    expect(encodeFilterValue('plain-value')).toBe('plain-value');
  });
});

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
