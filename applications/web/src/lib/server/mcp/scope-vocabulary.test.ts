import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { tribunalScopeVocabulary, type TribunalMcpScope } from './scope-vocabulary';

const documentedVocabulary = readFileSync(
  fileURLToPath(new URL('../../../../../../documentation/mcp-scopes.md', import.meta.url)),
  'utf8',
);

const productionScopes: TribunalMcpScope[] = [
  'repositories:read',
  'pull_requests:read',
  'reviews:read',
  'review_findings:read',
  'cost_events:read',
];

describe('tribunalScopeVocabulary', () => {
  it('declares the five production scopes plus the reserved conformance scope', () => {
    expect.assertions(1);

    expect(tribunalScopeVocabulary.scopes).toEqual([...productionScopes, 'conformance:read']);
  });

  it('gives every scope consent-screen copy', () => {
    expect.assertions(6);

    for (const scope of tribunalScopeVocabulary.scopes) {
      expect(tribunalScopeVocabulary.descriptions[scope].length).toBeGreaterThan(0);
    }
  });

  it('names every scope in the settled vocabulary document', () => {
    expect.assertions(6);

    for (const scope of tribunalScopeVocabulary.scopes) {
      expect(documentedVocabulary).toContain(scope);
    }
  });

  it('narrows a member of the vocabulary', () => {
    expect.assertions(1);

    expect(tribunalScopeVocabulary.isScope('reviews:read')).toBe(true);
  });

  it.each(['', '*', 'reposotories:read', 'admin', 'repositories:write'])(
    'refuses %s, which no primitive can require',
    (candidate) => {
      expect.assertions(1);

      expect(tribunalScopeVocabulary.isScope(candidate)).toBe(false);
    },
  );

  it('expresses no all-access scope', () => {
    expect.assertions(1);

    expect(tribunalScopeVocabulary.scopes.filter((scope) => !scope.endsWith(':read'))).toEqual([]);
  });
});
