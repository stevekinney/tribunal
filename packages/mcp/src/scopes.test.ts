import { describe, expect, it } from 'vitest';
import { isMcpScope, mcpScopeDescriptions, mcpScopes } from './scopes';

describe('mcpScopes', () => {
  it('contains the full, small vocabulary', () => {
    expect(mcpScopes).toEqual(['profile:read', 'audit:read', 'prompts:read']);
  });

  it('has a description for every declared scope', () => {
    for (const scope of mcpScopes) {
      expect(mcpScopeDescriptions[scope]).toBeTruthy();
    }
  });
});

describe('isMcpScope', () => {
  it('returns true for every real scope value', () => {
    for (const scope of mcpScopes) {
      expect(isMcpScope(scope)).toBe(true);
    }
  });

  it('returns false for a value not in the vocabulary', () => {
    expect(isMcpScope('not_a_real_scope')).toBe(false);
  });

  it('returns false for an empty string', () => {
    expect(isMcpScope('')).toBe(false);
  });
});
