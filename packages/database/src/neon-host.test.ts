import { describe, expect, it } from 'vitest';
import { shouldUseNeonHttp } from './neon-host';

describe('shouldUseNeonHttp', () => {
  it('matches .neon.tech and .neon.build hosts', () => {
    expect(shouldUseNeonHttp('postgresql://user:pass@db.example.neon.tech/main')).toBe(true);
    expect(shouldUseNeonHttp('postgresql://user:pass@db.example.neon.build/main')).toBe(true);
  });

  it('does not match a bare apex host with no subdomain', () => {
    // shouldUseNeonHttp requires a leading dot (`endsWith('.neon.tech')`), so
    // the apex domain itself does not match. Real Neon connection strings
    // always have a project subdomain, so this is intentional, not a gap.
    expect(shouldUseNeonHttp('postgresql://user:pass@neon.tech/main')).toBe(false);
    expect(shouldUseNeonHttp('postgresql://user:pass@neon.build/main')).toBe(false);
  });

  it('rejects lookalike hosts that merely contain the suffix as a substring', () => {
    // A naive substring check (rather than a hostname-suffix check) would
    // wrongly match these. This is security-relevant: environment.ts uses
    // this predicate to exempt a host from the production TLS requirement.
    expect(shouldUseNeonHttp('postgresql://user:pass@evilneon.tech/main')).toBe(false);
    expect(shouldUseNeonHttp('postgresql://user:pass@notneon.build/main')).toBe(false);
  });

  it('rejects a host where the Neon suffix appears as a leading label, not a trailing suffix', () => {
    // The attacker controls everything before the real suffix, so this must
    // not match: neon.tech here is a subdomain of example.com, not the host.
    expect(shouldUseNeonHttp('postgresql://user:pass@neon.tech.example.com/main')).toBe(false);
    expect(shouldUseNeonHttp('postgresql://user:pass@neon.build.example.com/main')).toBe(false);
  });

  it('returns false rather than throwing for an unparseable connection string', () => {
    // Exported as a general-purpose predicate; a caller should not need to
    // guard it with URL.canParse first.
    expect(shouldUseNeonHttp('not a url')).toBe(false);
    expect(shouldUseNeonHttp('')).toBe(false);
  });

  it('rejects a Neon-hostname URL with a non-Postgres scheme', () => {
    // A matching hostname is not enough: z.string().url() accepts
    // https://db.example.neon.tech/main as a generically valid URL, but the
    // Neon HTTP driver requires a postgres:/postgresql: connection string.
    // Without this check, environment.ts would exempt a value from the
    // production TLS check that isn't a valid PostgreSQL connection string
    // at all, deferring the real failure from boot-time environment
    // validation to first database use.
    expect(shouldUseNeonHttp('https://db.example.neon.tech/main')).toBe(false);
    expect(shouldUseNeonHttp('http://db.example.neon.build/main')).toBe(false);
  });

  it('rejects non-Neon hosts, including local hosts', () => {
    expect(shouldUseNeonHttp('postgres://tribunal:tribunal@localhost:5432/tribunal')).toBe(false);
    expect(
      shouldUseNeonHttp('postgres://tribunal:tribunal@host.docker.internal:5433/tribunal'),
    ).toBe(false);
    expect(shouldUseNeonHttp('postgresql://user:pass@db.example.com/main')).toBe(false);
  });
});
