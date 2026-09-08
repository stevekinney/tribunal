import { describe, expect, it } from 'vitest';
import { tribunalOAuthScopeConfiguration } from './scopes';

describe('tribunalOAuthScopeConfiguration', () => {
  it('exposes the production vocabulary and a non-empty supported-scope set', () => {
    expect(tribunalOAuthScopeConfiguration.supportedScopes.length).toBeGreaterThan(0);
    expect(tribunalOAuthScopeConfiguration.supportedScopes).toContain('repositories:read');
    expect(tribunalOAuthScopeConfiguration.vocabulary.scopes).toContain('repositories:read');
  });

  it('excludes the conformance-only scope from the supported set', () => {
    expect(tribunalOAuthScopeConfiguration.supportedScopes).not.toContain('conformance:read');
  });
});
