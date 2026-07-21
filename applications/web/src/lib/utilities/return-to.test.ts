import { describe, expect, it } from 'vitest';
import { sanitizeReturnTo } from './return-to';

describe('sanitizeReturnTo', () => {
  it('defaults to / when the URL is null', () => {
    expect(sanitizeReturnTo(null)).toBe('/');
  });

  it('defaults to / for a relative path that does not start with /', () => {
    expect(sanitizeReturnTo('repositories')).toBe('/');
  });

  it('rejects a protocol-relative URL (open redirect guard)', () => {
    expect(sanitizeReturnTo('//evil.example.com')).toBe('/');
  });

  it('rejects a javascript: URL', () => {
    expect(sanitizeReturnTo('javascript:alert(1)')).toBe('/');
  });

  it('rejects a data: URL', () => {
    expect(sanitizeReturnTo('data:text/html,<script>alert(1)</script>')).toBe('/');
  });

  it('preserves the path, query, and hash of a valid in-app path', () => {
    expect(sanitizeReturnTo('/repositories?tab=active#top')).toBe('/repositories?tab=active#top');
  });

  it('redirects the GitHub account callback path to /connect/github', () => {
    expect(sanitizeReturnTo('/connect/github/account/callback')).toBe('/connect/github');
  });

  it('falls back to / when the WHATWG URL parser throws', () => {
    // A lone trailing backslash is not a parseable URL and throws; the
    // function must fail closed to "/" rather than propagate the error.
    expect(sanitizeReturnTo('/\\')).toBe('/');
  });
});
