import { describe, expect, it } from 'vitest';
import {
  InvalidEventListenerFiltersError,
  parseEventListenerFilters,
  serializeEventListenerFilters,
} from '../event-listener-filters';

describe('serializeEventListenerFilters', () => {
  it('serializes an empty/undefined filter set to an empty object', () => {
    expect(serializeEventListenerFilters(undefined)).toBe('{}');
    expect(serializeEventListenerFilters(null)).toBe('{}');
    expect(serializeEventListenerFilters({})).toBe('{}');
  });

  it('serializes named string and integer filters', () => {
    const json = serializeEventListenerFilters({
      ref: 'refs/heads/main',
      prNumber: 42,
      issueNumber: 7,
      senderLogin: 'octocat',
    });
    expect(JSON.parse(json)).toEqual({
      ref: 'refs/heads/main',
      prNumber: 42,
      issueNumber: 7,
      senderLogin: 'octocat',
    });
  });

  it('rejects unsupported filter keys', () => {
    expect(() => serializeEventListenerFilters({ branch: 'main' })).toThrow(
      InvalidEventListenerFiltersError,
    );
  });

  it('rejects non-integer values for numeric filters', () => {
    expect(() => serializeEventListenerFilters({ prNumber: 'forty-two' })).toThrow(
      InvalidEventListenerFiltersError,
    );
    expect(() => serializeEventListenerFilters({ prNumber: 4.2 })).toThrow(
      InvalidEventListenerFiltersError,
    );
  });

  it('rejects empty string values', () => {
    expect(() => serializeEventListenerFilters({ ref: '' })).toThrow(
      InvalidEventListenerFiltersError,
    );
  });

  it('rejects arrays and non-object input', () => {
    expect(() => serializeEventListenerFilters(['nope'])).toThrow(InvalidEventListenerFiltersError);
    expect(() => serializeEventListenerFilters('nope')).toThrow(InvalidEventListenerFiltersError);
  });

  it('drops null/undefined values instead of storing them', () => {
    const json = serializeEventListenerFilters({ ref: 'refs/heads/main', prNumber: undefined });
    expect(JSON.parse(json)).toEqual({ ref: 'refs/heads/main' });
  });
});

describe('parseEventListenerFilters', () => {
  it('parses a serialized filter set back to typed fields', () => {
    const json = serializeEventListenerFilters({ prNumber: 42, senderLogin: 'octocat' });
    expect(parseEventListenerFilters(json)).toEqual({ prNumber: 42, senderLogin: 'octocat' });
  });

  it('returns null (fail closed) for malformed JSON rather than throwing or matching everything', () => {
    expect(parseEventListenerFilters('not json')).toBeNull();
    expect(parseEventListenerFilters('[]')).toBeNull();
    expect(parseEventListenerFilters('null')).toBeNull();
  });

  it('parses a valid empty object as "no filters" (matches everything of the event type/action)', () => {
    expect(parseEventListenerFilters('{}')).toEqual({});
  });

  it('fails closed (does not match anything) when stored JSON contains an unsupported key, instead of silently dropping it and matching everything', () => {
    expect(parseEventListenerFilters(JSON.stringify({ branch: 'main' }))).toBeNull();
    expect(parseEventListenerFilters(JSON.stringify({ branch: 'main', ref: 'ok' }))).toBeNull();
  });

  it('fails closed when a supported key holds a mistyped value', () => {
    expect(parseEventListenerFilters(JSON.stringify({ prNumber: 'nope' }))).toBeNull();
    expect(parseEventListenerFilters(JSON.stringify({ ref: 123 }))).toBeNull();
    expect(parseEventListenerFilters(JSON.stringify({ ref: '' }))).toBeNull();
  });
});
