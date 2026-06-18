import { describe, expect, it } from 'vitest';
import {
  buildProxyOnlyEgressConfiguration,
  makeSandboxMetadata,
  makeSandboxName,
  validateCloneInput,
} from './configuration';

describe('sandbox configuration', () => {
  it('generates deterministic sandbox names and metadata', () => {
    expect(makeSandboxName({ repositoryId: 42, pullRequestNumber: 7 })).toBe('tribunal-pr-42-7');
    expect(
      Object.keys(
        makeSandboxMetadata({
          repositoryId: 42,
          pullRequestNumber: 7,
          owner: 'stevekinney',
          name: 'tribunal',
        }),
      ),
    ).toEqual(['managedBy', 'owner', 'pullRequestNumber', 'repositoryId', 'repositoryName']);
  });

  it('represents proxy-only egress without credentials', () => {
    expect(
      buildProxyOnlyEgressConfiguration({
        proxyUrl: 'https://proxy.tribunal.local',
        proxyCidr: '10.0.0.8/32',
      }),
    ).toEqual({
      allowInternetAccess: false,
      allowOut: ['10.0.0.8/32'],
      secretNames: [],
      env: {
        TRIBUNAL_PROXY_URL: 'https://proxy.tribunal.local',
        ANTHROPIC_BASE_URL: 'https://proxy.tribunal.local/anthropic',
      },
    });
  });

  it('rejects invalid repository clone inputs', () => {
    expect(
      validateCloneInput({
        repositoryUrl: 'https://github.com/owner/repository.git',
        headSha: 'a'.repeat(40),
      }).ok,
    ).toBe(true);
    expect(
      validateCloneInput({
        repositoryUrl: 'https://evil.example.com/owner/repository.git',
        headSha: 'a'.repeat(40),
      }).ok,
    ).toBe(false);
    expect(
      validateCloneInput({
        repositoryUrl: 'https://github.com/owner/repository.git',
        headSha: 'not-a-sha',
      }).ok,
    ).toBe(false);
  });
});
